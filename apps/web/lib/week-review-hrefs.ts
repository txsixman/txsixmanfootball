import { ORGS, orgHref, type Org } from "./orgs";

// Week in review addresses, one organization at a time (ADR 0012). UIL is the default and has no organization segment; the
// others end in theirs, as the Results pages do:
//   /weeks                    every week with a game, newest season first       /weeks/tapps
//   /weeks/2025/9             that season's week 9                              /weeks/2025/9/tapps

export const weekHref = (season: number, week: number, org: Org = ORGS[0]) => orgHref(`/weeks/${season}/${week}`, org);
export const indexHref = (org: Org = ORGS[0]) => orgHref("/weeks", org);
