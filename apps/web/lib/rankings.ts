import { type Alignment, loadAlignments, programsFor } from "@/lib/alignments";
import { memo } from "@/lib/memo";
import { orgByLeague, orgHref, type Org } from "@/lib/orgs";
import { placeRows, rangeText } from "@/lib/rank-range";
import { loadRatings, type RatingRow } from "@/lib/ratings";

// The rankings, for pages that need one team's place. One rating scale underneath, but a rank is a place within ONE
// organization (ADR 0012): `inOrg` among its organization's teams, `inDivision` among UIL six-man Division I or II.
// There is no all-league rank. `teams` is best first (across every organization), each row carrying its `school`.
// A team with too few games takes no rank (lib/rank-range.ts: NR), so `inOrg` and `inDivision` are then undefined.
// `range` is the rank range within the group the label names (the division for UIL six-man, else the organization).
export type Ranked = RatingRow & { school: Alignment; org: Org; inOrg?: number; inDivision?: number; range?: { best: number; worst: number } };

/** "Division I" for a UIL six-man school; undefined for the other organizations, which rank only within the organization. */
const uilDivision = (a: Pick<Alignment, "league" | "division">) =>
  a.league === "UIL" && (a.division === "I" || a.division === "II") ? `Division ${a.division}` : undefined;

/** Where a school's rank is shown: "#4 in Division I" for UIL six-man, else "#4 in TAPPS", with the page that lists it;
 * "Not ranked" for a team with too few games. `range` is its rank range there ("#2 to #9"). */
export function rankLabel(r: Pick<Ranked, "school" | "org" | "inOrg" | "inDivision" | "range">): { text: string; sub?: string; href: string; range?: string } {
  const division = uilDivision(r.school);
  const href = division ? `/rankings/division-${r.school.division === "I" ? 1 : 2}` : orgHref("/rankings", r.org);
  const range = r.range && rangeText(r.range);
  if (division) {
    return r.inDivision == null
      ? { text: "Not ranked", sub: "Too few games", href }
      : { text: `#${r.inDivision} in ${division}`, sub: `#${r.inOrg} in ${r.org.label}`, href, range };
  }
  return r.inOrg == null ? { text: "Not ranked", sub: "Too few games", href } : { text: `#${r.inOrg} in ${r.org.label}`, href, range };
}

/** Teams of a ratings table with the school each is (by current alignment), once for each league that lists it (ADR
 * 0012: a school two leagues list is ranked in both, counted within each). A team no alignment knows (out of state,
 * 11-man, a past opponent) belongs to no organization: it is left out and counted in `outside`, never an error. */
export function placeTeams<T extends { team: string }>(teams: T[], alignments: Alignment[]): { placed: (T & { school: Alignment })[]; outside: number } {
  const placed = teams.flatMap((t) => programsFor(alignments, t.team).map((school) => ({ ...t, school })));
  return { placed, outside: teams.filter((t) => !programsFor(alignments, t.team).length).length };
}

/** Read once per process: never mutate it. */
export const loadRanked = memo<void, { season: number; games: number; teams: Ranked[] }>(async () => {
  const [table, alignments] = await Promise.all([loadRatings(), loadAlignments()]);
  const placed = placeTeams(table.teams, alignments).placed.flatMap((r) => {
    const org = orgByLeague(r.school.league);
    return org ? [{ ...r, org }] : []; // a league with no organization row yet: not shown, like an unknown team
  });
  // Ranks, counted among the teams of one group at a time: an organization, or a UIL six-man division within it.
  const groups = Map.groupBy(placed, (r) => r.org.league);
  const divisions = Map.groupBy(placed.filter((r) => uilDivision(r.school)), (r) => uilDivision(r.school)!);
  const inOrg = new Map([...groups].map(([league, rows]) => [league, placeRows(rows)]));
  const inDivision = new Map([...divisions].map(([division, rows]) => [division, placeRows(rows)]));
  const teams = placed.map((r): Ranked => {
    const division = uilDivision(r.school);
    const org = inOrg.get(r.org.league)!.get(r.team)!;
    const div = division ? inDivision.get(division)!.get(r.team)! : undefined;
    return { ...r, inOrg: org.rank, inDivision: div?.rank, range: (div ?? org).range };
  });
  return { season: table.season, games: table.games, teams };
});
