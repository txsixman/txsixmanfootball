// Standings by level (ADR 0048): a UIL division's districts grouped into areas and regions. Pure, no imports but types,
// so scripts/standings-levels.test.mjs runs it as it is.
//
// An area is the pair of districts that cross over in bi-district: districts 2k-1 and 2k (the 2026-28 UIL alignment
// PDFs, Divisions I and II: 1 and 2 play W1 v R2 and W2 v R1, 3 and 4, ... 15 and 16). A region is the alignment's own
// region column. Only levels the alignment holds are shown: TAPPS and TCAF have districts and no regions, TAIAO has
// regions and no districts. No level is made up.
import type { DistrictStandings, Record3, StandingRow } from "./standings";

export type Level = "district" | "area" | "region";
export const LEVEL_LABEL: Record<Level, string> = { district: "District", area: "Area", region: "Region" };

/** The two districts of a district's area: the bi-district crossover pair, 2k-1 and 2k. */
export function areaPair(district: number): [number, number] {
  if (!Number.isInteger(district) || district < 1) throw new Error(`not a district number: ${district}`);
  const low = district % 2 ? district : district - 1;
  return [low, low + 1];
}

/** A team in an area or region table, with the district it plays in. */
export type RankedRow = StandingRow & { districtNumber: string };
export type AreaGroup = { id: string; number: number; label: string; districts: DistrictStandings[]; rows: RankedRow[] };
export type RegionGroup = { id: string; region: string; label: string; areas: AreaGroup[]; rows: RankedRow[] };

const winPct = (r: Record3) => (r.won + r.lost + r.tied ? (r.won + r.tied / 2) / (r.won + r.lost + r.tied) : 0);
const diff = (r: StandingRow) => r.pointsFor - r.pointsAgainst;

/** Every team of these districts in one table: overall win %, then point difference, then name. */
export function ranked(districts: DistrictStandings[]): RankedRow[] {
  return districts
    .flatMap((d) => d.rows.map((r) => ({ ...r, districtNumber: r.school.district })))
    .sort((x, y) => winPct(y.overall) - winPct(x.overall) || diff(y) - diff(x) || x.school.school.localeCompare(y.school.school));
}

const numbered = (d: DistrictStandings) => /^\d+$/.test(d.rows[0]?.school.district ?? "") && /^\d+$/.test(d.rows[0]?.school.region ?? "");

/** The levels a page's districts have, in the switcher's order. */
export function levelsOf(districts: DistrictStandings[]): Level[] {
  if (!districts.length) return ["district"];
  if (districts.every((d) => !d.districtPlay)) return ["region"];
  return districts.every((d) => d.districtPlay && numbered(d)) ? ["district", "area", "region"] : ["district"];
}

/** "Districts 1–2", or "District 15" when its pair has no teams in the alignment. */
const districtsLabel = (ds: DistrictStandings[]) => {
  const n = ds.map((d) => d.rows[0].school.district);
  return n.length > 1 ? `Districts ${n[0]}–${n.at(-1)}` : `District ${n[0]}`;
};

/**
 * Regions, each with its areas (district pairs, numbered 1, 2, ... within the region by their lower district) and each
 * area with its districts, in district order. For districts with numbered regions and districts only (levelsOf).
 */
export function regionsOf(districts: DistrictStandings[], idPrefix = "s"): RegionGroup[] {
  const num = (d: DistrictStandings) => Number(d.rows[0].school.district);
  const byRegion = new Map<string, DistrictStandings[]>();
  for (const d of [...districts].sort((a, b) => num(a) - num(b))) {
    const region = d.rows[0].school.region;
    byRegion.set(region, [...(byRegion.get(region) ?? []), d]);
  }
  return [...byRegion.entries()]
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([region, ds]) => {
      const byPair = new Map<number, DistrictStandings[]>();
      for (const d of ds) {
        const [low] = areaPair(num(d));
        byPair.set(low, [...(byPair.get(low) ?? []), d]);
      }
      const label = `Region ${region}`;
      const areas = [...byPair.values()].map((pair, i) => ({
        id: `${idPrefix}-r${region}-a${i + 1}`,
        number: i + 1,
        label: `${label} · Area ${i + 1} (${districtsLabel(pair)})`,
        districts: pair,
        rows: ranked(pair),
      }));
      return { id: `${idPrefix}-r${region}`, region, label, areas, rows: ranked(ds) };
    });
}

/** "Region 1 · Area 1 (Districts 1–2) · District 1". */
export const districtLabel = (area: AreaGroup, d: DistrictStandings) => `${area.label} · District ${d.rows[0].school.district}`;
