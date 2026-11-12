import { memo } from "./memo";
import { ORGS, type Org } from "./orgs";
import { resultSeasons } from "./weeks";

// An organization with no game on this site has nothing to rank or list, so it gets no tab and no page. Independent
// (schools that name no league) starts that way: its first team is in the alignments, but its games reach the files
// only when the results robot next reads them. Every other organization always has games.
const withGames = memo<void, ReadonlySet<Org>>(async () => {
  const played = await Promise.all(ORGS.map(async (o) => (await resultSeasons(o)).length > 0));
  return new Set<Org>(ORGS.filter((_, i) => played[i]));
});

/** The organizations to offer as tabs, in site order: those with a game in any season, and `keep` (the page being shown). */
export const activeOrgs = async (keep?: Org): Promise<Org[]> => {
  const active = await withGames();
  return ORGS.filter((o) => o === keep || active.has(o));
};

/** The non-default organizations that have pages, as `generateStaticParams` wants them for a `[org]` segment. */
export const orgParams = async () => (await activeOrgs()).slice(1).map((o) => ({ org: o.slug }));
