import { loadAlignments, type Alignment } from "./alignments";
import { inOrg, type Org } from "./orgs";

// Which organization a robot-read game or team belongs to (ADR 0012). Results and Records come from game files that
// carry no league, so the current alignments decide: a team is in the organizations that list it, and a team no
// alignment lists (out of state, 11-man, a past opponent) is in none.

/** School name to the alignment rows that list it (two when a school is in two organizations, like Grayson Christian). */
export const schoolAlignments = async (): Promise<Map<string, Alignment[]>> => Map.groupBy(await loadAlignments(), (a) => a.school);

export const teamInOrg = (schools: Map<string, Alignment[]>, org: Org, team: string): boolean =>
  (schools.get(team) ?? []).some((a) => inOrg(org, a));

/** A game belongs under each team's own organization, so it is in `org` when either team is (ADR 0012). */
export const gameInOrg = (schools: Map<string, Alignment[]>, org: Org, game: { home: string; away: string }): boolean =>
  teamInOrg(schools, org, game.home) || teamInOrg(schools, org, game.away);
