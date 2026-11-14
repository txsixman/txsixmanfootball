import { slugify } from "./slug.ts";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./supabase-public.ts";

// Live scores during a game (migration 0016, ADR 0021). Results watch writes the score of each game under way to the
// table live_score every 10 minutes; the browser reads it through the function live_scores() with Supabase's public key
// (lib/supabase-public.ts, the one push uses; no sign-in setting is involved) and shows it beside the
// game. It is the read's score, not a result: always "Unconfirmed", never a winner or leader. Imports two plain files
// only, so the node tests run it as it is.

/** One row of live_score, checked. A row that fails is dropped, never shown. */
export type LiveRow = {
  game_key: string;
  home: string;
  away: string;
  home_score: number;
  away_score: number;
  period: string | null;
  /** Time left in the period ("4:12"), when the reader has it; absent until it does (the page then leaves it out). */
  clock?: string | null;
  /** The read saw the game finished (migration 0019, ADR 0041): its last score, "Score reported", until our own final. */
  finished?: boolean;
  read_at: string;
};

// The row check is written out by hand, not with Zod: this file runs on every page with a scoreboard, and Zod's runtime
// was 32 KB of the JavaScript every phone downloaded. scripts/live-scores.test.mjs holds the Zod schema it replaced and
// checks that both accept and reject exactly the same rows, so the rules are the schema's, field for field.
const text = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max;
const score = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= 200;
const period = (v: unknown): v is string | null => v === null || (text(v, 12) && /^[A-Za-z0-9 ]+$/.test(v));
/** Absent, null, or minutes and seconds ("4:12", "0:09", "12:00"). */
const clockOf = (v: unknown): v is string | null | undefined => v === undefined || v === null || (text(v, 5) && /^\d{1,2}:[0-5]\d$/.test(v));
/** An RFC 3339 time with seconds and a Z or ±hh:mm offset, on a real calendar day (Zod's `z.iso.datetime({ offset: true })`). */
const ISO_TIME = /^(\d{4})-(\d\d)-(\d\d)T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
function isoTime(v: unknown): v is string {
  const m = typeof v === "string" ? ISO_TIME.exec(v) : null;
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1];
  return days !== undefined && d >= 1 && d <= days;
}
/** The row's own fields when every one passes (anything else on it is dropped), else null. */
function liveRow(r: unknown): LiveRow | null {
  if (typeof r !== "object" || r === null || Array.isArray(r)) return null;
  const { game_key, home, away, home_score, away_score, period: p, clock, finished, read_at } = r as Record<string, unknown>;
  if (!text(game_key, 200) || !text(home, 80) || !text(away, 80) || !score(home_score) || !score(away_score) || !period(p) || !clockOf(clock) || !(finished === undefined || typeof finished === "boolean") || !isoTime(read_at)) return null;
  return { game_key, home, away, home_score, away_score, period: p, ...(clock !== undefined && { clock }), ...(finished !== undefined && { finished }), read_at };
}

/** A row read longer ago than this is not shown: the writer replaces rows every 10 minutes, so an older one means the
 * reads stopped, and "live" would be a guess. (The database drops rows after 6 hours either way.) */
export const LIVE_MAX_AGE_MS = 90 * 60_000;

/** The rows of a live_score response that pass the checks, newest read first not required; anything but a list is nothing. */
export function parseLiveRows(json: unknown): LiveRow[] {
  if (!Array.isArray(json) || json.length > 200) return [];
  return json.flatMap((row) => liveRow(row) ?? []);
}

/** Twin of `gameKey` in lib/games.ts (that file reads files, so a browser cannot import it): the date, then both
 * program slugs, sorted. Change both together. */
export const liveKey = (date: string, home: string, away: string) => [date, ...[slugify(home), slugify(away)].sort()].join("|");

/** The rows of the public function live_scores() (migration 0016): the one thing the API roles can read here, and read-only. */
export async function fetchLiveRows(signal?: AbortSignal, supabase = { url: SUPABASE_URL, key: SUPABASE_PUBLISHABLE_KEY }): Promise<LiveRow[]> {
  const res = await fetch(`${supabase.url}/rest/v1/rpc/live_scores`, {
    method: "POST",
    headers: { apikey: supabase.key, "Content-Type": "application/json" },
    body: "{}",
    cache: "no-store",
    signal,
  });
  if (!res.ok) throw new Error(`live_scores: ${res.status}`);
  return parseLiveRows(await res.json());
}

/** What a page shows for one game under way: the two scores in the page's own order (away listed first, as the pages do). */
export type LiveView = { away: { name: string; score: number }; home: { name: string; score: number }; period: string | null; clock: string | null; finished: boolean; readAt: Date };

/** The live row for a game, with each score on the right team (the row's home and away may differ from the page's: a
 * neutral site has no real home), or null when there is none, or the row is too old, its teams are not this game's, or it is 0-0 with no period. */
export function liveView(rows: LiveRow[], game: { date?: string; home: string; away: string }, now = Date.now()): LiveView | null {
  if (!game.date) return null;
  const row = rows.find((r) => r.game_key === liveKey(game.date!, game.home, game.away));
  const readAt = row && new Date(row.read_at);
  if (!row || !readAt || now - readAt.getTime() > LIVE_MAX_AGE_MS || readAt.getTime() - now > 10 * 60_000) return null;
  const [home, away] = [slugify(game.home), slugify(game.away)];
  const score = (slug: string) => (row.home === slug ? row.home_score : row.away === slug ? row.away_score : null);
  const [h, a] = [score(home), score(away)];
  if (h === null || a === null || home === away) return null;
  // 0-0 with no period may be a game that has not kicked off: not shown as live (the reader skips it too, maxpreps.mjs liveRows).
  if (h === 0 && a === 0 && row.period === null) return null;
  return { away: { name: game.away, score: a }, home: { name: game.home, score: h }, period: row.period, clock: row.clock ?? null, finished: row.finished === true, readAt };
}

/** "7:42 PM CT": when the read was made, in the time zone the games are played in. */
export const checkedAt = (at: Date) =>
  `${new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" }).format(at)} CT`;

/** Where a game under way stands, beside its score: "Q3 · 4:12 left · as of 7:42 PM CT". The period reads "Live" when the
 * read has none, and the time left is left out until the reader has it. A game the read saw finished: "Score reported ·
 * as of 9:05 PM CT" (ADR 0041), never "In progress" and never "Final": only our own final is that. */
export const liveStatus = (live: LiveView) =>
  live.finished
    ? `Score reported · as of ${checkedAt(live.readAt)}`
    : [live.period ?? "Live", live.clock && `${live.clock} left`, `as of ${checkedAt(live.readAt)}`].filter(Boolean).join(" · ");

/** The fields of a game the board needs to show it live (lib/demo-games.ts Game; named here so this file stays plain). */
type BoardGame = {
  state: "live" | "final" | "scheduled" | "postponed";
  status: string;
  homeScore: number | null;
  awayScore: number | null;
  verification: "confirmed" | "unconfirmed" | "disputed" | "none";
  projected?: string;
  projectedMargin?: number;
  upset?: boolean;
};

/**
 * A game with no final as the scores board shows it while a live row says it is under way: Live, the read's period as its
 * status, the read's scores in its own score cells (each on the right team), and unconfirmed, so it is dashed and names no
 * winner (lib/score-display.ts winnerOf). Its projection is dropped: a pre-game estimate beside a score under way would
 * read as a second answer.
 */
export function asLive<G extends BoardGame>(g: G, live: LiveView): G {
  return {
    ...g,
    // A game the read saw finished is a reported score, not a live one: it sits with the other unconfirmed finals
    // ("Score reported", dashed, no winner) until our own final replaces it (ADR 0041).
    state: live.finished ? "final" : "live",
    status: live.finished ? "Score reported" : (live.period ?? ""),
    homeScore: live.home.score,
    awayScore: live.away.score,
    verification: "unconfirmed",
    projected: undefined,
    projectedMargin: undefined,
    upset: undefined,
  };
}
