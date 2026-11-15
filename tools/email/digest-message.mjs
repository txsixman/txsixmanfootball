// The weekly digest email (ADR 0055): subject, plain text, HTML and the unsubscribe headers. A plain summary of the teams a fan
// follows: last week's confirmed result, the ranking move, the next game with its chance to win. Never a source's name, never a
// betting word (the only odds-like words are "chance to win"), no marketing. Ends with why they got it, an Unsubscribe link and
// the sender's postal address, which the digest cannot go without. Pure.
import { unsubscribeUrl } from "../../apps/web/lib/email/unsubscribe.ts";
import { chanceText } from "./digest-data.mjs";
import { clock, escapeHtml, oneLine, ROUND } from "./message.mjs";

/** A digest lists at most this many teams; the rest are on the account page. */
export const MAX_TEAMS = 25;
const MAX_ADDRESS_LINES = 5;
const MAX_ADDRESS_CHARS = 300;

/**
 * The postal address from the repo variable EMAIL_POSTAL_ADDRESS, as lines: `{ lines }`, or `{ error }` when it is unset, empty,
 * or not an address a footer can hold (more than 5 lines or 300 characters, or markup). The digest refuses to send without it.
 */
export function postalAddress(value) {
  const lines = String(value ?? "").split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  if (!lines.length) return { error: "not set" };
  if (lines.length > MAX_ADDRESS_LINES || lines.join("\n").length > MAX_ADDRESS_CHARS || lines.some((l) => /[<>]/.test(l))) return { error: "not a postal address a footer can hold" };
  return { lines };
}

const dayLabel = (date) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

/** "Final score: Beta 14, Alpha 40." / "No game last week." */
function lastLine(last) {
  if (last.kind === "result") return `Final score: ${oneLine(last.away)} ${last.awayScore}, ${oneLine(last.home)} ${last.homeScore}.`;
  return last.kind === "unconfirmed" ? "No confirmed result yet." : "No game last week.";
}

/** "#4 in Division I, up 2 places from #6." and its other cases; null when the team has no ranking data this week. */
export function rankingLine(r) {
  if (!r) return null;
  if (r.place == null) return "Not ranked yet: too few games.";
  const where = `#${r.place} in ${r.group}`;
  if (r.moved === undefined) return `${where}.`;
  if (r.moved === "new") return `${where}, new in the rankings.`;
  if (r.moved === 0) return `${where}, about the same as last week.`;
  const places = `${Math.abs(r.moved)} ${Math.abs(r.moved) === 1 ? "place" : "places"}`;
  return `${where}, ${r.moved > 0 ? "up" : "down"} ${places} from #${r.before}.`;
}

/** "Beta vs Alpha (Regional). Fri, Nov 20, 7:30 PM Central. Chance to win: Beta 26%, Alpha 74%." */
function nextLine(next) {
  if (!next) return "No game scheduled.";
  const when = next.date ? [dayLabel(next.date), next.kickoff ? clock(next.kickoff) : undefined].filter(Boolean).join(", ") : "Date to be listed";
  const round = next.round && ROUND[next.round] ? ` (${ROUND[next.round]})` : "";
  const chance = next.homeChance == null ? "" : ` Chance to win: ${oneLine(next.away)} ${chanceText(1 - next.homeChance)}, ${oneLine(next.home)} ${chanceText(next.homeChance)}.`;
  return `${oneLine(next.away)} vs ${oneLine(next.home)}${round}. ${when}.${chance}`;
}

/**
 * The digest for one fan: `teams` are digestData's sections for the teams they follow (best to give only the first MAX_TEAMS);
 * `token` their weekly_digest unsubscribe token; `postal` the lines postalAddress returned. Returns { subject, text, html, headers }.
 */
export function buildDigest({ teams, more = 0, token, origin, postal }) {
  const account = `${origin}/account`;
  const page = unsubscribeUrl(origin, token, "/account/email/unsubscribe");
  const oneClick = unsubscribeUrl(origin, token);
  const why = "You are getting this because you turned on the weekly digest on your account.";
  const sections = teams.map((t) => ({
    name: oneLine(t.name),
    href: `${origin}/programs/${t.slug}`,
    rows: [["Last week", lastLine(t.last)], ...(rankingLine(t.ranking) ? [["Ranking", rankingLine(t.ranking)]] : []), ["Next game", nextLine(t.next)]],
  }));
  const extra = more > 0 ? `${more} more ${more === 1 ? "team" : "teams"} you follow ${more === 1 ? "is" : "are"} on your account.` : "";
  const text = [
    "Your weekly team digest",
    "",
    ...sections.flatMap((s) => [s.name, ...s.rows.map(([k, v]) => `${k}: ${v}`), s.href, ""]),
    ...(extra ? [extra, ""] : []),
    why,
    `Change it: ${account}`,
    `Unsubscribe: ${page}`,
    "",
    ...postal,
    "",
  ].join("\n");
  const html = [
    `<h1 style="font-size:20px;margin:0 0 16px">Your weekly team digest</h1>`,
    ...sections.map(
      (s) =>
        `<h2 style="font-size:17px;margin:20px 0 6px"><a href="${escapeHtml(s.href)}">${escapeHtml(s.name)}</a></h2>\n` +
        s.rows.map(([k, v]) => `<p style="font-size:15px;line-height:1.5;margin:0 0 4px"><strong>${escapeHtml(k)}:</strong> ${escapeHtml(v)}</p>`).join("\n"),
    ),
    ...(extra ? [`<p style="font-size:15px;line-height:1.5;margin:20px 0 0">${escapeHtml(extra)}</p>`] : []),
    `<p style="font-size:13px;line-height:1.5;color:#555;margin:24px 0 0">${escapeHtml(why)} <a href="${escapeHtml(account)}">Change it</a> or <a href="${escapeHtml(page)}">unsubscribe</a>.</p>`,
    `<p style="font-size:12px;line-height:1.5;color:#555;margin:8px 0 0">${postal.map(escapeHtml).join("<br>")}</p>`,
  ].join("\n");
  return {
    subject: "Your weekly team digest",
    text,
    html,
    headers: { "List-Unsubscribe": `<${oneClick}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
  };
}
