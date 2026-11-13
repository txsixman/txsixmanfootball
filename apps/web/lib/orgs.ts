import type { Alignment } from "./alignments";

/** The organizations a six-man team plays in. Each stands alone on every page (ADR 0012): no list, table, filter or
 * ranking puts teams or games of two organizations together, because people follow one organization, not all of them.
 * UIL is first, so it is each section's default page; the others live at `<base>/<slug>`. `standings` is false for an
 * organization with no districts to put standings on (Independent: schools that name no league). */
export const ORGS = [
  { league: "UIL", slug: "uil", label: "UIL", standings: true },
  { league: "TAPPS", slug: "tapps", label: "TAPPS", standings: true },
  { league: "TAIAO", slug: "taiao", label: "TAIAO", standings: true },
  { league: "TCAF", slug: "tcaf", label: "TCAF", standings: true },
  { league: "Independent", slug: "independent", label: "Independent", standings: false },
] as const;

export type Org = (typeof ORGS)[number];

export const orgBySlug = (slug: string): Org | undefined => ORGS.find((o) => o.slug === slug);
export const orgByLeague = (league: string): Org | undefined => ORGS.find((o) => o.league === league);

/** `/rankings` for UIL, `/rankings/tapps` for TAPPS, and so on. */
export const orgHref = (base: string, org: Org): string => (org === ORGS[0] ? base : `${base}/${org.slug}`);

/** True when the school plays in the organization. A school unknown to the current alignments is in none. */
export const inOrg = (org: Org, school: Pick<Alignment, "league"> | undefined): boolean => school?.league === org.league;

/** The organization a game's label names: "UIL D1 · Bi-district" and "TCAF · Final" start with it (ADR 0012). */
export const orgOfLabel = (label: string): Org | undefined => ORGS.find((o) => label === o.league || label.startsWith(`${o.league} `));
