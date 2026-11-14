import { gameNight } from "./game-night.ts";
import { checkedAt } from "./live-scores.ts";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./supabase-public.ts";

// "Scores checked 4 min ago" (migration 0017, ADR 0038). Results watch records when each game-day read finished in the table
// read_status; the browser reads it through the public function results_read_at() and says how fresh the scores are. The
// time is when the read ran, not when a score changed, and it names no source. Imports plain files only, so the node tests
// run it as it is.

/** After the first kickoff of the day, a read newer than this many minutes past it is expected; none means "may be behind". */
export const BEHIND_AFTER_MS = 30 * 60_000;

/** A game as the scoreboards hold it. A kickoff is known only for a game not yet played. */
export type DayGame = { date?: string; kickoff?: string; state?: string };

/** What today's games say about the day: `started` once a game is under way or played, `first` the earliest kickoff still
 * listed (a played game no longer lists its own, so after the first final it is a later game's). Null when no game is on
 * today's game night (lib/game-night.ts), the only day the page asks for anything. */
export function gameDay(games: DayGame[], now: number): { started: boolean; first: number | null } | null {
  const night = gameNight(new Date(now));
  const today = games.filter((g) => g.date === night);
  if (!today.length) return null;
  const kickoffs = today.flatMap((g) => (g.kickoff ? [Date.parse(g.kickoff)] : [])).filter((t) => !Number.isNaN(t));
  const first = kickoffs.length ? Math.min(...kickoffs) : null;
  const begun = today.some((g) => g.state === "final" || g.state === "forfeit" || g.state === "live");
  return { started: begun || (first !== null && now >= first), first };
}

/** The line to show, or null for nothing. `readAt` is the answer of a successful request (null: no read recorded); a failed
 * request never gets here. */
export function checkedLine(day: { started: boolean; first: number | null }, readAt: number | null, now: number): string | null {
  if (!day.started) return null;
  if (day.first !== null && now > day.first + BEHIND_AFTER_MS && (readAt === null || readAt <= day.first + BEHIND_AFTER_MS)) {
    return "Scores may be behind";
  }
  if (readAt === null) return null;
  const minutes = Math.floor(Math.max(0, now - readAt) / 60_000);
  if (minutes < 1) return "Scores checked just now";
  if (minutes < 60) return `Scores checked ${minutes} min ago`;
  return `Scores checked at ${checkedAt(new Date(readAt))}`;
}

/** The time of the last read from the public function results_read_at() (null when none is recorded). Throws on a failed
 * request or an answer that is neither a time nor null. */
export async function fetchReadAt(signal?: AbortSignal, supabase = { url: SUPABASE_URL, key: SUPABASE_PUBLISHABLE_KEY }): Promise<number | null> {
  const res = await fetch(`${supabase.url}/rest/v1/rpc/results_read_at`, {
    method: "POST",
    headers: { apikey: supabase.key, "Content-Type": "application/json" },
    body: "{}",
    cache: "no-store",
    signal,
  });
  if (!res.ok) throw new Error(`results_read_at: ${res.status}`);
  const json: unknown = await res.json();
  if (json === null) return null;
  const at = typeof json === "string" ? Date.parse(json) : NaN;
  if (Number.isNaN(at)) throw new Error("results_read_at: not a time");
  return at;
}
