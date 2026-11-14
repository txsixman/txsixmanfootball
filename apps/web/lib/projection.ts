import type { RatingsTable } from "./ratings";
import { slugify } from "./slug";

// A projected margin and win probability for a game not yet played, from the same model as /rankings: the rating
// difference, plus the home-field edge unless the site is neutral, turned into a calibrated win probability.
// The words are projected margin and chance to win (ADR 0045); never spreads, lines or odds.

/** Standard normal CDF (Abramowitz and Stegun 7.1.26, error under 1.5e-7). */
export function normalCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

export type Projection = { favorite: string; margin: number; winProbability: number };

/**
 * P(the home side wins) for a projected margin. With the table's `calibration` it is logistic in the margin (scale in
 * points, services/ratings/model.py `calibrated_probability` is its twin): the fit's own normal chance was too sure
 * (walk-forward, 2022 to 2026: 99% said, 97% happened), and this one is calibrated to the games it had not seen. A table
 * without it (a hand-built one in a test) falls back to the normal chance at `sigma`.
 */
export function homeWinProbability(margin: number, table: Pick<RatingsTable, "calibration" | "sigma">): number | undefined {
  if (table.calibration) return 1 / (1 + Math.exp(-margin / table.calibration.scale));
  return table.sigma == null ? undefined : normalCdf(margin / table.sigma);
}

/** The home edge in points a listed home team gets: the full `home_field`, or the `playoff_edge` share of it at a neutral site. */
export function homeEdge(table: Pick<RatingsTable, "home_field" | "playoff_edge">, neutral: boolean, trueNeutral = false): number {
  return neutral ? (trueNeutral ? 0 : (table.home_field ?? 0) * (table.playoff_edge ?? 0)) : (table.home_field ?? 0);
}

/**
 * undefined when either team is unrated, or the table predates home_field and sigma. `neutral` is a site the data calls
 * neutral or does not name, which for a robot-read playoff game still gives the listed home team `playoff_edge` of the
 * home edge (a fitted share: those games are mostly neutral but the listed home side did better); `trueNeutral` (the
 * Matchup picker's neutral button) gives none.
 */
export function project(table: RatingsTable, home: string, away: string, neutral: boolean, trueNeutral = false): Projection | undefined {
  if (table.sigma == null || table.home_field == null) return undefined;
  const rating = new Map(table.teams.map((t) => [slugify(t.team), t.rating]));
  const h = rating.get(slugify(home));
  const a = rating.get(slugify(away));
  if (h == null || a == null) return undefined;
  const margin = h - a + homeEdge(table, neutral, trueNeutral);
  const p = homeWinProbability(margin, table)!;
  return margin >= 0
    ? { favorite: home, margin, winProbability: p }
    : { favorite: away, margin: -margin, winProbability: 1 - p };
}

/** A chance as a percent: never 100% or 0%. */
export const chanceText = (p: number) => (p > 0.99 ? ">99%" : p < 0.01 ? "<1%" : `${Math.round(p * 100)}%`);

/** The two halves of the text: "Jayton by 12" and "74% chance to win" (the favorite's). A margin past 45 reads "by 45+", since the
 * game would end there; one that rounds to 0 reads "by less than 1", never a margin the win probability contradicts. */
export function projectionParts({ favorite, margin, winProbability }: Projection): { margin: string; chance: string } {
  const by = margin >= 45 ? "45+" : margin < 0.5 ? "less than 1" : String(Math.round(margin));
  // ">99%" is earned: in the walk-forward backtest (2022 to 2026) the favorite won 99.6% of the 695 games the calibrated
  // chance put at 99% or more (data/ratings/backtest.json, calibration.bands_calibrated). Nothing is ever shown as 100%.
  return { margin: `${favorite} by ${by}`, chance: `${chanceText(winProbability)} chance to win` };
}

/** "Jayton by 12 · 74% chance to win". */
export function projectionText(p: Projection): string {
  const { margin, chance } = projectionParts(p);
  return `${margin} · ${chance}`;
}
