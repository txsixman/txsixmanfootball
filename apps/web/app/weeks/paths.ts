import { activeOrgs } from "@/lib/active-orgs";
import { ORGS, orgBySlug, type Org } from "@/lib/orgs";
import { resultSeasons } from "@/lib/weeks";
import { reviewedWeeks, reviewPages } from "@/lib/week-review-load";

// A week page exists only for an organization with a game that week, so no tab leads to an empty page (addresses: lib/week-review-hrefs.ts).

export type Where = { org: Org } & ({ season?: undefined; week?: undefined } | { season: number; week: number });

/** What a path under /weeks shows, or undefined when no page has that address. */
export async function parseWeeksPath(path: string[] = []): Promise<Where | undefined> {
  const parts = [...path];
  const last = parts.length ? orgBySlug(parts[parts.length - 1]) : undefined;
  if (last && last !== ORGS[0]) parts.pop(); // `uil` is never an address: UIL is the page without an organization
  const org = last && last !== ORGS[0] ? last : ORGS[0];
  if (!(await activeOrgs()).includes(org)) return undefined;
  if (!parts.length) return { org };
  if (parts.length !== 2 || !parts.every((p) => /^\d+$/.test(p))) return undefined;
  const [season, week] = parts.map(Number);
  return (await resultSeasons(org)).includes(season) && (await reviewedWeeks(season, org)).some((w) => w.number === week) ? { org, season, week } : undefined;
}

/** Every address that has a page: per active organization, its index and each of its weeks with a game. */
export async function weekPaths(): Promise<string[][]> {
  const per = await Promise.all(
    (await activeOrgs()).map(async (org) => {
      const end = org === ORGS[0] ? [] : [org.slug];
      return [end, ...(await reviewPages(org)).map(({ season, week }) => [String(season), String(week), ...end])];
    }),
  );
  return per.flat();
}
