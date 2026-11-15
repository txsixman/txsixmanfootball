// One game-alert email (ADR 0053): subject, plain text, HTML and the unsubscribe headers. Plain alerts only: the facts of the
// game and a link to the team's page. Never a source's name, never a betting word; the words are "chance to win" if one ever
// appears. Pure: the only secret is the unsubscribe secret, passed in.
import { unsubscribeUrl } from "../../apps/web/lib/email/unsubscribe.ts";

const ROUND = { "round-1": "First round", "bi-district": "Bi-district", area: "Area", quarterfinal: "Quarterfinal", regional: "Regional", semifinal: "Semifinal", final: "Final", state: "State final" };

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
/** A header or subject value on one line, whatever a team name holds. */
const oneLine = (s) => String(s).replace(/[\r\n]+/g, " ").trim();

const clock = (iso) =>
  `${new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" }).format(new Date(iso))} Central`;

/** The email for one due row of email_pending_game_alerts: { subject, text, html, headers }. */
export function buildGameAlert(row, { origin, secret }) {
  const away = oneLine(row.away_name);
  const home = oneLine(row.home_name);
  const mine = oneLine(row.followed_slug === row.home_slug ? row.home_name : row.away_name);
  let subject;
  let line;
  if (row.alert === "final") {
    subject = `Final: ${away} ${row.away_score}, ${home} ${row.home_score}`;
    line = `Final score: ${away} ${row.away_score}, ${home} ${row.home_score}.`;
  } else if (row.alert === "kickoff") {
    subject = `Kickoff: ${away} vs ${home}`;
    line = row.kickoff_at ? `${away} and ${home} kicked off at ${clock(row.kickoff_at)}.` : `${away} and ${home} are kicking off.`;
  } else if (row.alert === "next_game") {
    const round = ROUND[row.round] ?? "Next";
    subject = `Next game set: ${away} vs ${home}`;
    line = `${round} game: ${away} vs ${home}. The date and place are on the team page once they are listed.`;
  } else {
    throw new Error("unknown alert");
  }
  const page = `${origin}/programs/${row.followed_slug}`;
  const account = `${origin}/account`;
  const kind = "game_alerts";
  const linkPage = unsubscribeUrl(origin, secret, row.user_id, kind, "/account/email/unsubscribe");
  const oneClick = unsubscribeUrl(origin, secret, row.user_id, kind);
  const why = `You are getting this because you turned on email alerts for ${mine} on your account.`;
  const text = [line, "", `${mine} on TX Six-Man Football: ${page}`, "", why, `Change it: ${account}`, `Unsubscribe: ${linkPage}`, ""].join("\n");
  const html = [
    `<p style="font-size:16px;line-height:1.5;margin:0 0 12px">${escapeHtml(line)}</p>`,
    `<p style="font-size:16px;line-height:1.5;margin:0 0 20px"><a href="${escapeHtml(page)}">${escapeHtml(mine)} on TX Six-Man Football</a></p>`,
    `<p style="font-size:13px;line-height:1.5;color:#555;margin:0">${escapeHtml(why)} <a href="${escapeHtml(account)}">Change it</a> or <a href="${escapeHtml(linkPage)}">unsubscribe</a>.</p>`,
  ].join("\n");
  return {
    subject,
    text,
    html,
    // RFC 8058: an https address a mail app POSTs to, with no sign-in. (A mailto form is optional and not offered.)
    headers: { "List-Unsubscribe": `<${oneClick}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
  };
}
