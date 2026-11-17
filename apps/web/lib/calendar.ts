// Calendar feeds (ADR 0095): this season's games as an iCalendar file (RFC 5545) a phone can subscribe to, written at build
// time. Pure, two local imports: the node tests run it as it is. A game with no date is left out; a game with a kickoff
// (UTC) is a timed event, else an all-day one on its date. A played game says its final only when it is confirmed.

import { kickoffTime } from "./kickoff.ts";
import { SITE_URL } from "./site.ts";

/** One game as a feed needs it. `status`: still to play, a confirmed final, a score reported but not confirmed (the sources
 * disagree, ADR 0040), or a forfeit (no score is shown, ADR 0004). `site` and `address`: where, when known, never a guess. */
export type CalendarGame = {
  id: string;
  date?: string;
  /** Kickoff in UTC, "2026-11-20T01:00:00Z". */
  kickoff?: string;
  away: string;
  home: string;
  /** The bracket and round, or the season, as the page words it. */
  label?: string;
  site?: string;
  address?: string;
  status: "to-play" | "final" | "reported" | "forfeit";
  score?: { away: number; home: number };
};

/** How long a timed event runs: a six-man game with halftime and a delay or two. */
const GAME_HOURS = 3;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The address of a calendar page on this site, in the form an iPhone or a Mac subscribes to. */
export const webcalUrl = (path: string) => `${SITE_URL.replace(/^https:/, "webcal:")}${path}`;

/** A TEXT value (RFC 5545 3.3.11): backslash, semicolon and comma escaped, a line break written \n, other control characters dropped. */
export function escapeText(text: string): string {
  return text
    .replace(/\r\n|\r|\n/g, "\n")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .replace(/[\\;,]/g, (c) => `\\${c}`)
    .replace(/\n/g, "\\n");
}

const encoder = new TextEncoder();

/** A content line folded at 75 octets (RFC 5545 3.1): each continuation starts with one space, and a character is never split. */
export function fold(line: string): string {
  const parts: string[] = [];
  let current = "";
  let bytes = 0;
  for (const ch of line) {
    const size = encoder.encode(ch).length;
    // The first line holds 75 octets; a continuation's leading space is one of its 75.
    if (bytes + size > 75) {
      parts.push(current);
      current = " ";
      bytes = 1;
    }
    current += ch;
    bytes += size;
  }
  parts.push(current);
  return parts.join("\r\n");
}

const pad = (n: number) => String(n).padStart(2, "0");
/** "20261120T010000Z". */
const utcStamp = (d: Date) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
const dayStamp = (iso: string) => iso.replaceAll("-", "");

/** A real calendar day, "YYYY-MM-DD". */
const isDay = (s: string | undefined): s is string => !!s && DAY.test(s) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`)) && new Date(`${s}T12:00:00Z`).toISOString().startsWith(s);

/** The kickoff as a time, or undefined when it is missing or not a UTC time. */
const kickoffAt = (g: CalendarGame): Date | undefined => {
  const at = g.kickoff && UTC.test(g.kickoff) ? new Date(g.kickoff) : undefined;
  return at && !Number.isNaN(at.getTime()) ? at : undefined;
};

/** The words under an event's title: when and what it was, and the game's page. A score is a final only when it is confirmed. */
function describe(g: CalendarGame): string {
  const result = g.score ? `${g.away} ${g.score.away}, ${g.home} ${g.score.home}` : "";
  const lines = [
    g.status === "final" && result ? `Final: ${result}.`
    : g.status === "reported" && result ? `Score reported: ${result}.`
    : g.status === "forfeit" ? "Forfeit. No score was played."
    : kickoffAt(g) ? `Kickoff ${kickoffTime(g.kickoff!)}.`
    : "Kickoff time not listed yet.",
    g.label,
    `Game page: ${SITE_URL}/scores/${g.id}`,
  ];
  return lines.filter(Boolean).join("\n");
}

/** The event lines of one game, or none when it has no real date. */
function eventLines(g: CalendarGame, stamp: string): string[] {
  if (!isDay(g.date)) return [];
  const at = kickoffAt(g);
  const next = new Date(Date.parse(`${g.date}T12:00:00Z`) + 24 * 3600_000);
  return [
    "BEGIN:VEVENT",
    `UID:${g.id}@${new URL(SITE_URL).host}`,
    `DTSTAMP:${stamp}`,
    ...(at
      ? [`DTSTART:${utcStamp(at)}`, `DTEND:${utcStamp(new Date(at.getTime() + GAME_HOURS * 3600_000))}`]
      : [`DTSTART;VALUE=DATE:${dayStamp(g.date)}`, `DTEND;VALUE=DATE:${dayStamp(next.toISOString().slice(0, 10))}`]),
    `SUMMARY:${escapeText(`${g.away} vs ${g.home}`)}`,
    `DESCRIPTION:${escapeText(describe(g))}`,
    ...(g.site ? [`LOCATION:${escapeText(g.address ? `${g.site}, ${g.address}` : g.site)}`] : []),
    `URL:${SITE_URL}/scores/${g.id}`,
    "END:VEVENT",
  ];
}

/**
 * The whole file: a calendar named `name` holding each game with a date, earliest first. `now` stamps the events (and so
 * changes with each build); calendars check the feed again every few hours, the way a phone reads a subscription.
 */
export function calendarFile(name: string, games: CalendarGame[], now: Date): string {
  const stamp = utcStamp(now);
  // By day, then kickoff (a game with none first), then id: the same order on every build.
  const order = (g: CalendarGame) => `${g.date}|${kickoffAt(g) ? g.kickoff : ""}|${g.id}`;
  const sorted = games.filter((g) => isDay(g.date)).sort((a, b) => order(a).localeCompare(order(b)));
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//TX Six-Man Football//Game calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(name)}`,
    `NAME:${escapeText(name)}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT6H",
    "X-PUBLISHED-TTL:PT6H",
    ...sorted.flatMap((g) => eventLines(g, stamp)),
    "END:VCALENDAR",
  ];
  return `${lines.map(fold).join("\r\n")}\r\n`;
}

/** A feed or a game's file as a response: a calendar, kept out of search results (it is for a calendar app, not a reader). */
export const calendarResponse = (body: string) =>
  new Response(body, { headers: { "Content-Type": "text/calendar; charset=utf-8", "X-Robots-Tag": "noindex" } });
