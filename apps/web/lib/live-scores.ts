import { z } from "zod";
import { slugify } from "./slug.ts";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./supabase-public.ts";

// Live scores during a game (migration 0016, ADR 0021). Results watch writes the score of each game under way to the
// table live_score every 10 minutes; the browser reads it through the function live_scores() with Supabase's public key
// (lib/supabase-public.ts, the one push uses; no sign-in setting is involved) and shows it beside the
// game. It is the read's score, not a result: always "Unconfirmed", never a winner or leader. Imports nothing but zod and
// two plain files, so the node tests run it as it is.

/** One row of live_score, checked. A row that fails is dropped, never shown. */
const LiveRowSchema = z.object({
  game_key: z.string().max(200),
  home: z.string().max(80),
  away: z.string().max(80),
  home_score: z.number().int().min(0).max(200),
  away_score: z.number().int().min(0).max(200),
  period: z.string().min(1).max(12).regex(/^[A-Za-z0-9 ]+$/).nullable(),
  read_at: z.iso.datetime({ offset: true }),
});
export type LiveRow = z.infer<typeof LiveRowSchema>;

/** A row read longer ago than this is not shown: the writer replaces rows every 10 minutes, so an older one means the
 * reads stopped, and "live" would be a guess. (The database drops rows after 6 hours either way.) */
export const LIVE_MAX_AGE_MS = 90 * 60_000;

/** The rows of a live_score response that pass the checks, newest read first not required; anything but a list is nothing. */
export function parseLiveRows(json: unknown): LiveRow[] {
  if (!Array.isArray(json) || json.length > 200) return [];
  return json.flatMap((row) => {
    const parsed = LiveRowSchema.safeParse(row);
    return parsed.success ? [parsed.data] : [];
  });
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
export type LiveView = { away: { name: string; score: number }; home: { name: string; score: number }; period: string | null; readAt: Date };

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
  return { away: { name: game.away, score: a }, home: { name: game.home, score: h }, period: row.period, readAt };
}

/** "7:42 PM CT": when the read was made, in the time zone the games are played in. */
export const checkedAt = (at: Date) =>
  `${new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" }).format(at)} CT`;
