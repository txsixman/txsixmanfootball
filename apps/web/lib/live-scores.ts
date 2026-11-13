import { z } from "zod";
import { authEnv, type AuthEnv } from "./auth/config.ts";
import { slugify } from "./slug.ts";

// Live scores during a game (migration 0016, ADR 0021). Results watch writes the score of each game under way to the
// public table live_score every 10 minutes; the browser reads it here with Supabase's public key and shows it beside the
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

/** The Supabase address and public key, or null (nothing is shown). The two NEXT_PUBLIC names are written out in full so
 * Next puts their values into the browser's code. */
export const liveEnv = (): AuthEnv | null =>
  authEnv({ NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY });

/** Every live row, as the REST API serves the table to the anon role (row-level security allows reading it, nothing more). */
export async function fetchLiveRows(env: AuthEnv, signal?: AbortSignal): Promise<LiveRow[]> {
  const base = env.url.replace(/\/$/, "");
  const res = await fetch(`${base}/rest/v1/live_score?select=game_key,home,away,home_score,away_score,period,read_at`, {
    headers: { apikey: env.anonKey, Authorization: `Bearer ${env.anonKey}`, Accept: "application/json" },
    cache: "no-store",
    signal,
  });
  if (!res.ok) throw new Error(`live_score: ${res.status}`);
  return parseLiveRows(await res.json());
}

/** What a page shows for one game under way: the two scores in the page's own order (away listed first, as the pages do). */
export type LiveView = { away: { name: string; score: number }; home: { name: string; score: number }; period: string | null; readAt: Date };

/** The live row for a game, with each score on the right team (the row's home and away may differ from the page's: a
 * neutral site has no real home), or null when there is none, or the row is too old, or its teams are not this game's. */
export function liveView(rows: LiveRow[], game: { date?: string; home: string; away: string }, now = Date.now()): LiveView | null {
  if (!game.date) return null;
  const row = rows.find((r) => r.game_key === liveKey(game.date!, game.home, game.away));
  const readAt = row && new Date(row.read_at);
  if (!row || !readAt || now - readAt.getTime() > LIVE_MAX_AGE_MS || readAt.getTime() - now > 10 * 60_000) return null;
  const [home, away] = [slugify(game.home), slugify(game.away)];
  const score = (slug: string) => (row.home === slug ? row.home_score : row.away === slug ? row.away_score : null);
  const [h, a] = [score(home), score(away)];
  if (h === null || a === null || home === away) return null;
  return { away: { name: game.away, score: a }, home: { name: game.home, score: h }, period: row.period, readAt };
}

/** "7:42 PM CT": when the read was made, in the time zone the games are played in. */
export const checkedAt = (at: Date) =>
  `${new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" }).format(at)} CT`;
