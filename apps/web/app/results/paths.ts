import { ORGS, orgBySlug, orgHref, type Org } from "@/lib/orgs";
import { loadWeeks, resultSeasons } from "@/lib/weeks";

// Results URLs, one organization at a time (ADR 0012). UIL is the default and has no organization segment; the others
// end in theirs, like /playoffs/season/2025/tapps:
//   /results                    latest season, latest week      /results/tapps
//   /results/2025               that season's last week         /results/2025/tapps
//   /results/2025/9             that season's week 9            /results/2025/9/tapps
// One optional catch-all serves them all: a season or week and an organization share a position, so no fixed
// segment names can tell /results/2025/tapps from /results/2025/9.

export const weekHref = (season: number, week: number, org: Org = ORGS[0]) => orgHref(`/results/${season}/${week}`, org);

/** The page an organization's season tab opens: the organization's latest season is its bare address. */
export const seasonHref = (season: number, latest: number, org: Org = ORGS[0]) =>
  orgHref(season === latest ? "/results" : `/results/${season}`, org);

export type Where = { org: Org; season: number; week: number; games: number };

/** What a path under /results shows, or undefined when no page has that address. */
export async function parseResultsPath(path: string[] = []): Promise<Where | undefined> {
  const parts = [...path];
  // `uil` is never an address: UIL is the page without an organization.
  const last = parts.length ? orgBySlug(parts[parts.length - 1]) : undefined;
  if (last && last !== ORGS[0]) parts.pop();
  const org = last && last !== ORGS[0] ? last : ORGS[0];
  if (parts.length > 2 || !parts.every((p) => /^\d+$/.test(p))) return undefined;
  const seasons = await resultSeasons(org);
  const season = parts[0] ? Number(parts[0]) : seasons[0];
  if (!seasons.includes(season)) return undefined;
  const weeks = await loadWeeks(season, org);
  const week = parts[1] ? Number(parts[1]) : weeks.at(-1)?.number;
  const shown = weeks.find((w) => w.number === week);
  return shown ? { org, season, week: shown.number, games: shown.games.length } : undefined;
}

/** Every address that has a page: per organization, its bare address, each older season, and every week of every
 * season it played in. A week the organization had no game in is still a page (empty), so the week tabs and the
 * organization tabs never lead to a missing one. */
export async function resultPaths(): Promise<string[][]> {
  const per = await Promise.all(
    ORGS.map(async (org) => {
      const end = org === ORGS[0] ? [] : [org.slug];
      const seasons = await resultSeasons(org);
      if (!seasons.length) return []; // no game yet (Independent before the robot reads one): no page, no tab
      const paths: string[][] = [end];
      for (const [i, season] of seasons.entries()) {
        if (i > 0) paths.push([String(season), ...end]);
        for (const w of await loadWeeks(season)) paths.push([String(season), String(w.number), ...end]);
      }
      return paths;
    }),
  );
  return per.flat();
}
