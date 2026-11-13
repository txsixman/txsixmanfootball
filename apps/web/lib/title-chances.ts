import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { heading, loadAlignments, type Alignment } from "./alignments";
import { parseCsv } from "./data-schemas";
import { memo } from "./memo";
import { type BracketGame, loadPlayoffGames, type PlayoffGame } from "./games";
import { project } from "./projection";
import { loadRatings, type RatingsTable } from "./ratings";
import { CURRENT_SEASON } from "./season";

// Title chances from the same win probabilities as the projections, for only the parts of a bracket the data settles.
//
// State title: the final alone, or two semifinals whose winners meet (the last four). A played but unconfirmed
// semifinal is not taken as settled (ADR 0004), so that bracket waits for the final.
//
// Region title (UIL): the data proves each region is closed. In past seasons every area and regional game, linked
// team to team, falls inside one group of eight (four districts, two teams each), so the two area games of a region
// decide who meets in its regional final, and only the semifinal crosses regions. Once a region has its two area games
// (or its regional game), nothing outside the data is needed to say who can win the region. Which bi-district winners
// meet in the area round, and which regions meet in the semifinals, are not in the data, so before that nothing is
// shown rather than a guess. A hand-entered semifinal pairing (bracket-template.csv, not yet written) lets state title
// chances show as soon as every region of a division is settled this way.
export type Chance = { team: string; chance: number };
export type BracketChances = { bracket: string; round: "final" | "semifinal" | "regional"; chances: Chance[] };
/** One region's chance to win its region title, from its two area games ("area") or its regional game ("regional"). */
export type RegionChances = { bracket: string; region: string; round: "area" | "regional"; chances: Chance[] };

/** Win probability of `a` over `b`, or undefined when either is unrated. With no `neutral` it is a pairing that has not
 * been made, or a final: a true neutral field, no edge either way. A listed game passes its own flag, and a playoff game the
 * data calls neutral still gives its listed home team the fitted playoff edge (lib/projection.ts). */
const beats = (t: RatingsTable, a: string, b: string, neutral?: boolean) => {
  const p = project(t, a, b, neutral ?? true, neutral === undefined);
  return p && (p.favorite === a ? p.winProbability : 1 - p.winProbability);
};

export function chancesFor(t: RatingsTable, games: BracketGame[]): BracketChances | undefined {
  const finals = games.filter((g) => g.round === "final" || g.round === "state");
  const semis = games.filter((g) => g.round === "semifinal");
  if (finals.length === 1 && !finals[0].played) {
    const [{ home, away }] = finals;
    const p = beats(t, home, away);
    if (p == null) return undefined;
    return { bracket: games[0].bracket, round: "final", chances: [{ team: home, chance: p }, { team: away, chance: 1 - p }].sort((x, y) => y.chance - x.chance) };
  }
  if (finals.length === 0 && semis.length === 2 && semis.every((g) => !g.played)) {
    const sides = semis.map((g) => [g.home, g.away]);
    const chances: Chance[] = [];
    for (const [i, side] of sides.entries()) {
      const other = sides[1 - i];
      for (const [j, team] of side.entries()) {
        const semi = beats(t, team, side[1 - j]);
        const vs = other.map((o, k) => [beats(t, o, other[1 - k]), beats(t, team, o)] as const);
        if (semi == null || vs.some(([a, b]) => a == null || b == null)) return undefined;
        chances.push({ team, chance: semi * vs.reduce((sum, [reach, win]) => sum + reach! * win!, 0) });
      }
    }
    return { bracket: games[0].bracket, round: "semifinal", chances: chances.sort((x, y) => y.chance - x.chance) };
  }
  return undefined;
}

// A winner distribution: each team's chance to come out of a piece of the bracket.
type Dist = Map<string, number>;
const byChance = (d: Dist): Chance[] => [...d].map(([team, chance]) => ({ team, chance })).sort((x, y) => y.chance - x.chance);

/** The winner of a game already on the schedule, at its own site. */
function playedAt(t: RatingsTable, g: BracketGame): Dist | undefined {
  const p = beats(t, g.home, g.away, g.neutral);
  return p == null ? undefined : new Map([[g.home, p], [g.away, 1 - p]]);
}

/** The winner of a game between whoever comes out of two pieces of bracket, on a neutral field. */
function meet(t: RatingsTable, a: Dist, b: Dist): Dist | undefined {
  const out: Dist = new Map();
  for (const [x, y] of [[a, b], [b, a]] as const) {
    for (const [team, reach] of x) {
      let win = 0;
      for (const [other, p] of y) {
        const w = beats(t, team, other);
        if (w == null) return undefined;
        win += p * w;
      }
      out.set(team, reach * win);
    }
  }
  return out;
}

/** Which two regions meet in each state semifinal, e.g. [["1","2"],["3","4"]]. */
export type SemifinalPairs = [[string, string], [string, string]];
/** What a UIL bracket knows beyond its games: each team's region (from the alignments), and a hand-entered semifinal pairing if there is one. */
export type UilContext = { regionOf: (team: string) => string | undefined; semifinals?: SemifinalPairs };

const ROUNDS_IN_REGION = new Set(["bi-district", "area", "regional"]);

/**
 * Each region's winner distribution, for the regions whose remaining path the data settles: two unplayed area games
 * (their winners meet in the regional final) or one unplayed regional game. undefined when a bi-district, area or
 * regional game links two regions or a team of unknown region, because then the closure the rule rests on is not true
 * of this bracket. A played but unconfirmed game settles nothing (ADR 0004); its region shows nothing.
 */
function regionDists(t: RatingsTable, games: BracketGame[], regionOf: UilContext["regionOf"]): Map<string, { round: "area" | "regional"; dist: Dist }> | undefined {
  const inRegion = new Map<string, BracketGame[]>();
  for (const g of games.filter((g) => ROUNDS_IN_REGION.has(g.round))) {
    const region = regionOf(g.home);
    if (region == null || region !== regionOf(g.away)) return undefined;
    inRegion.set(region, [...(inRegion.get(region) ?? []), g]);
  }
  const out = new Map<string, { round: "area" | "regional"; dist: Dist }>();
  for (const [region, list] of inRegion) {
    const regional = list.filter((g) => g.round === "regional");
    const area = list.filter((g) => g.round === "area");
    let found: { round: "area" | "regional"; dist: Dist | undefined } | undefined;
    if (regional.length === 1 && !regional[0].played) {
      found = { round: "regional", dist: playedAt(t, regional[0]) };
    } else if (regional.length === 0 && area.length === 2 && area.every((g) => !g.played) && new Set(area.flatMap((g) => [g.home, g.away])).size === 4) {
      const [a, b] = area.map((g) => playedAt(t, g));
      found = { round: "area", dist: a && b && meet(t, a, b) };
    }
    if (found?.dist) out.set(region, { round: found.round, dist: found.dist });
  }
  return out;
}

/** Chances for one bracket: the state title (last four, or a template plus every region settled) and each settled UIL region's title. */
export function titleChances(t: RatingsTable, games: BracketGame[], uil?: UilContext): { state?: BracketChances; regions: RegionChances[] } {
  const state = chancesFor(t, games);
  const dists = uil && regionDists(t, games, uil.regionOf);
  if (!uil || !dists) return { ...(state ? { state } : {}), regions: [] };
  const bracket = games[0].bracket;
  const regions = [...dists]
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([region, { round, dist }]) => ({ bracket, region, round, chances: byChance(dist) }));
  if (state || !uil.semifinals || games.some((g) => ["semifinal", "final", "state"].includes(g.round))) return { ...(state ? { state } : {}), regions };
  // The template path: all four regions settled, then the semifinals and the final are products of the same winner distributions.
  const sides = uil.semifinals.map(([a, b]) => {
    const [x, y] = [dists.get(a)?.dist, dists.get(b)?.dist];
    return x && y && meet(t, x, y);
  });
  const final = sides[0] && sides[1] && meet(t, sides[0], sides[1]);
  return { ...(final ? { state: { bracket, round: "regional" as const, chances: byChance(final) } } : {}), regions };
}

/** Hand-entered semifinal pairings by bracket name ("UIL Division I"). Empty until bracket-template.csv exists. */
export type BracketTemplate = Map<string, SemifinalPairs>;
const TEMPLATE_FILE = "uil-2026-28/bracket-template.csv";
const TEMPLATE_COLUMNS = ["division", "semifinal", "region_a", "region_b"];
const TemplateRow = z.object({
  division: z.enum(["I", "II"]),
  semifinal: z.enum(["1", "2"]),
  region_a: z.enum(["1", "2", "3", "4"]),
  region_b: z.enum(["1", "2", "3", "4"]),
});

/** Parses bracket-template.csv: two rows per division, naming the pair of regions in each state semifinal; all four regions once. */
export function parseTemplate(csv: string): BracketTemplate {
  const rows = parseCsv(`data/seed/${TEMPLATE_FILE}`, csv, TEMPLATE_COLUMNS, TemplateRow).map(({ row }) => row);
  const out: BracketTemplate = new Map();
  for (const division of new Set(rows.map((r) => r.division))) {
    const mine = rows.filter((r) => r.division === division).sort((a, b) => a.semifinal.localeCompare(b.semifinal));
    const regions = mine.flatMap((r) => [r.region_a, r.region_b]);
    if (mine.length !== 2 || mine[0].semifinal === mine[1].semifinal || new Set(regions).size !== 4) {
      throw new Error(`data/seed/${TEMPLATE_FILE}: Division ${division} needs semifinals 1 and 2 naming regions 1 to 4 once each`);
    }
    out.set(heading({ league: "UIL", division, region: "1" }), [[mine[0].region_a, mine[0].region_b], [mine[1].region_a, mine[1].region_b]]);
  }
  return out;
}

const readTemplate = () =>
  readFile(path.join(process.cwd(), "../../data/seed", TEMPLATE_FILE), "utf8").then(parseTemplate, (e: NodeJS.ErrnoException) => {
    if (e.code === "ENOENT") return new Map() as BracketTemplate;
    throw e;
  });

/** The template, or an empty one when the file has not been written. Read once per process: never mutate it. */
export const loadBracketTemplate = memo<void, BracketTemplate>(readTemplate);

/** Title chances for one bracket of a season's playoff games; regions and semifinal pairings apply to UIL only (ADR 0012). */
export function bracketTitleChances(t: RatingsTable, alignments: Alignment[], template: BracketTemplate, name: string, games: PlayoffGame[]) {
  const asGames: BracketGame[] = games.map((g) => ({ bracket: name, round: g.round, home: g.home, away: g.away, played: g.homeScore != null, neutral: g.neutral }));
  if (games[0]?.league !== "UIL") return titleChances(t, asGames);
  const region = new Map(alignments.filter((a) => a.league === "UIL" && heading(a) === name).map((a) => [a.school, a.region]));
  const semifinals = template.get(name);
  return titleChances(t, asGames, { regionOf: (team) => region.get(team), ...(semifinals ? { semifinals } : {}) });
}

export async function loadTitleChances(season = CURRENT_SEASON): Promise<{ state: BracketChances[]; regions: RegionChances[] }> {
  const [ratings, alignments, template] = await Promise.all([loadRatings(season), loadAlignments(), loadBracketTemplate()]);
  const games = await loadPlayoffGames(alignments, season);
  const found = [...Map.groupBy(games, (g) => g.bracket)].map(([name, list]) => bracketTitleChances(ratings, alignments, template, name, list));
  return { state: found.flatMap((f) => f.state ?? []), regions: found.flatMap((f) => f.regions) };
}
