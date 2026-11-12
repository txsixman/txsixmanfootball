import { CURRENT_SEASON } from "../season.ts";
import { requireAdmin } from "../auth/admin.ts";
import { type AdminGame, alignmentSchools, parseSeasonGames, readCorrections } from "./files.ts";
import { repoClient } from "./github.ts";
import { slugify } from "../slug.ts";

// The console's server-side wiring: the admin check, the GitHub client and the Supabase session, in one place.

/** The token, or null: with it missing the console reads "not configured" and nothing can be written. */
export const githubToken = () => process.env.GITHUB_CORRECTIONS_TOKEN?.trim() || null;

/** Every admin server action starts here: the signed-in admin (their own Supabase session) and a GitHub client, or a throw. */
export async function adminContext() {
  const { user, supabase } = await requireAdmin();
  const token = githubToken();
  if (!token) throw new Error("Admin is not configured");
  return { user, supabase, github: repoClient(token) };
}

export type Github = ReturnType<typeof repoClient>;

/** The correction files as they are on main right now, parsed (the page and each action read them fresh). */
export async function loadLiveCorrections(github: Github) {
  const [games, programs] = await Promise.all([github.readCorrectionFile("games"), github.readCorrectionFile("programs")]);
  return { ...readCorrections(games?.text ?? null, programs?.text ?? null), gamesText: games?.text ?? null, programsText: programs?.text ?? null };
}

/** A season's games from main, merged names. */
export async function loadLiveGames(github: Github, season: number, merges: Map<string, string>): Promise<AdminGame[]> {
  return parseSeasonGames(season, await github.readText(`data/seed/maxpreps-${season}/games.csv`), merges);
}

/** Slugs of every school any alignment lists, and the schools' names as listed. */
export async function loadLiveSchools(github: Github): Promise<{ names: string[]; slugs: Set<string> }> {
  const texts = await Promise.all(["uil-2026-28", "tapps-2026-28", "private-2026"].map((d) => github.readText(`data/seed/${d}/alignments.csv`)));
  const names = [...new Set(texts.flatMap(alignmentSchools))].sort();
  return { names, slugs: new Set(names.map(slugify)) };
}

/** Seasons the console can search, newest first. */
export const SEARCH_SEASONS = Array.from({ length: CURRENT_SEASON - 2021 + 1 }, (_, i) => CURRENT_SEASON - i);
