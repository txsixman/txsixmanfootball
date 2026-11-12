import { type Alignment, byDistrict, loadAlignments, placeLabel, slugify } from "./alignments";
import { memo } from "./memo";
import { gameKey, loadSeasonResults, playoffGameKeys, type SeasonResult } from "./games";

// District standings from the season's regular-season results (ADR 0008: unconfirmed, so a page says so). A district
// game is a regular-season one between two schools of the same league, division and numbered district: a playoff game
// counts toward the overall record and points, never the district record. Ordered by district record,
// then overall record; the leagues' own tiebreakers (head to head, points) are not applied.
export type Record3 = { won: number; lost: number; tied: number };
type StandingRow = { school: Alignment; district: Record3; overall: Record3; pointsFor: number; pointsAgainst: number };
/** `districtPlay` is false for a league with no districts (TAIAO): its group is a division and conference, ordered by
 * overall record, and no district record exists. Only `loadStandings(season, { conferences: true })` returns those, so a
 * program page's "place in district" never reads one. */
export type DistrictStandings = { key: string; title: string; league: string; division: string; districtPlay: boolean; rows: StandingRow[] };

const pct = (r: Record3) => (r.won + r.lost + r.tied ? (r.won + r.tied / 2) / (r.won + r.lost + r.tied) : 0);

/** Shared across pages (279 program pages ask for the same season): never mutate it. */
export const loadStandings = (season: number, { conferences = false } = {}): Promise<DistrictStandings[]> =>
  (conferences ? withConferences : withoutConferences)(season);

const build = (conferences: boolean) => memo(async (season: number): Promise<DistrictStandings[]> => {
  const [alignments, results, playoffs] = await Promise.all([loadAlignments(), loadSeasonResults(season), playoffGameKeys(season)]);
  return standingsFrom(alignments, results, playoffs, conferences);
});
const withConferences = build(true);
const withoutConferences = build(false);

/** The tally itself, on data already read. `playoffs` is `playoffGameKeys`: those games count toward overall records and
 * points, never toward a district record. */
export function standingsFrom(alignments: Alignment[], results: SeasonResult[], playoffs: ReadonlySet<string>, conferences = false): DistrictStandings[] {
  const groupOf = new Map<string, string>();
  const groups = byDistrict(alignments).filter((g) => (/^\d+$/.test(g.district) && g.district !== "0") || (conferences && g.district === "0"));
  // A group with district "0" has no districts, so none of its games is a district game.
  for (const g of groups) if (g.district !== "0") for (const s of g.schools) groupOf.set(s.slug, `${g.heading}|${g.district}`);

  const rows = new Map<string, StandingRow>();
  for (const g of groups) for (const s of g.schools) {
    rows.set(s.slug, { school: s, district: { won: 0, lost: 0, tied: 0 }, overall: { won: 0, lost: 0, tied: 0 }, pointsFor: 0, pointsAgainst: 0 });
  }
  for (const r of results) {
    const [h, a] = [slugify(r.home), slugify(r.away)];
    const inDistrict = groupOf.has(h) && groupOf.get(h) === groupOf.get(a) && !playoffs.has(gameKey(r.date, r.home, r.away));
    for (const [slug, us, them] of [[h, r.homeScore, r.awayScore], [a, r.awayScore, r.homeScore]] as const) {
      const row = rows.get(slug);
      if (!row) continue;
      const key = us > them ? "won" : us < them ? "lost" : "tied";
      row.overall[key] += 1;
      if (inDistrict) row.district[key] += 1;
      if (!r.forfeit) {
        // A forfeit's recorded 1-0 is not points scored.
        row.pointsFor += us;
        row.pointsAgainst += them;
      }
    }
  }
  return groups.map((g) => ({
    key: `${g.heading}|${g.district}`,
    title: g.district === "0" ? g.heading : `${g.heading} · ${placeLabel(g.schools[0])}`,
    league: g.schools[0].league,
    division: g.schools[0].division,
    districtPlay: g.district !== "0",
    rows: g.schools
      .map((s) => rows.get(s.slug)!)
      .sort((x, y) => pct(y.district) - pct(x.district) || y.district.won - x.district.won || pct(y.overall) - pct(x.overall) || x.school.school.localeCompare(y.school.school)),
  }));
}

/** The anchor a district's table carries on /standings, so other pages can link straight to it. */
export const districtId = (key: string) => `d-${key.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;

/** The standings tab a district is on. */
export const standingsHref = (d: Pick<DistrictStandings, "league" | "division" | "key">) =>
  `${d.league !== "UIL" ? `/standings/${d.league.toLowerCase()}` : d.division === "II" ? "/standings/division-2" : "/standings"}#${districtId(d.key)}`;

export const ordinal = (n: number) => `${n}${["th", "st", "nd", "rd"][n % 100 >= 11 && n % 100 <= 13 ? 0 : Math.min(n % 10, 4) % 4] ?? "th"}`;

/** "4-1" or "4-1-1". */
export const wl = (r: Record3) => (r.tied ? `${r.won}-${r.lost}-${r.tied}` : `${r.won}-${r.lost}`);

