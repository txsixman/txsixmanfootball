import type { Box } from "./line-chart.ts";
import { signed } from "./signed.ts";

// A team's season told week by week, from the ratings table's own `weeks`, `trend` and `rated_trend` (services/ratings/run.py
// --season rates the season's games up to each Sunday): nothing is rated again here (ADR 0091). Pure, so node tests it
// (scripts/rank-history.test.mjs); the drawing is app/programs/history-chart.tsx, the biggest-movers list
// app/rankings/movers.tsx. A rank counts teams with `few` or more rated games that week, in the table's own order (best
// rating first, ties as the file lists them), exactly as the rankings table counts it.

type Column = { team: string; trend?: (number | null)[]; rated_trend?: (number | null)[] };
export type WeekTable = { weeks?: string[]; teams: Column[] };

/** `rank`: place among `of` ranked teams that week, null while the team had fewer than `few` rated games. */
export type HistoryPoint = { week: string; rating: number; rank: number | null; of: number };

/** Every team's week-by-week points among the teams `inGroup` says count together (one organization: ADR 0012). A week a
 * team was unrated has no point. */
export function rankMatrix(table: WeekTable, inGroup: (team: string) => boolean, few: number): Map<string, HistoryPoint[]> {
  const weeks = table.weeks ?? [];
  const members = table.teams.filter((t) => inGroup(t.team));
  const out = new Map<string, HistoryPoint[]>(members.map((t) => [t.team, []]));
  weeks.forEach((week, i) => {
    const rated = members.filter((t) => t.trend?.[i] != null);
    const ranked = rated.filter((t) => (t.rated_trend?.[i] ?? 0) >= few).sort((a, b) => b.trend![i]! - a.trend![i]!);
    const place = new Map(ranked.map((t, at) => [t.team, at + 1]));
    for (const t of rated) out.get(t.team)!.push({ week, rating: t.trend![i]!, rank: place.get(t.team) ?? null, of: ranked.length });
  });
  return out;
}

/** A rating week is keyed by its Sunday (`weeks` in the ratings table). The pages name a week by its Monday, "week of Nov 16",
 * as the Results pages do ("Week 12, from Nov 16"): a Sunday that has not come yet is never called the week's end. */
const short = (sunday: string) =>
  new Date(Date.parse(`${sunday}T12:00:00Z`) - 6 * 86_400_000).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
export const weekLabel = short;

/** The chart's text alternative: where the team started, where it stands and its best, for rank and for rating. */
export function historySummary(points: HistoryPoint[], label: string): string {
  const first = points[0];
  const last = points.at(-1)!;
  const best = points.reduce((a, b) => (b.rating > a.rating ? b : a));
  const ranked = points.filter((p) => p.rank != null);
  const rating = `Rating from ${signed(first.rating)} in the week of ${short(first.week)} to ${signed(last.rating)} in the week of ${short(last.week)}; highest ${signed(best.rating)}. Zero is an average team.`;
  if (ranked.length < 2) return `${ranked.length ? `Ranked #${ranked[0].rank} in ${label} in the week of ${short(ranked[0].week)}.` : `Not ranked in ${label} in any of these weeks.`} ${rating}`;
  const [a, z] = [ranked[0], ranked.at(-1)!];
  const top = Math.min(...ranked.map((p) => p.rank!));
  return `Rank in ${label} from #${a.rank} in the week of ${short(a.week)} to #${z.rank} in the week of ${short(z.week)}; best #${top}. ${rating}`;
}

/** Where the rank line goes: 1 at the top, a gap (a broken line) in a week the team was not ranked, and the rank at each end of the axis. */
export function rankChart(points: { x: number; y: number | null }[], box: Box) {
  const known = points.filter((p): p is { x: number; y: number } => p.y != null);
  const [best, worst] = [Math.min(...known.map((p) => p.y)), Math.max(...known.map((p) => p.y))];
  const pad = Math.max(1, Math.round(Math.max(worst - best, 4) * 0.15));
  const [top, bottom] = [Math.max(1, best - pad), Math.max(worst + pad, best + 2)];
  const [xLo, xHi] = [points[0].x, points.at(-1)!.x];
  const px = (x: number) => box.left + (xHi === xLo ? 0.5 : (x - xLo) / (xHi - xLo)) * (box.width - box.left - box.right);
  const py = (y: number) => box.top + ((y - top) / (bottom - top)) * (box.height - box.top - box.bottom);
  const r = (n: number) => Math.round(n * 10) / 10;
  const runs: string[] = [];
  let run: string[] = [];
  const close = () => {
    if (run.length > 1) runs.push(run.join(" "));
    run = [];
  };
  for (const p of points) {
    if (p.y == null) close();
    else run.push(`${r(px(p.x))},${r(py(p.y))}`);
  }
  close();
  return {
    runs,
    dots: known.map((p) => ({ x: p.x, rank: p.y, cx: r(px(p.x)), cy: r(py(p.y)) })),
    yTicks: [top, bottom].map((rank) => ({ rank, cy: r(py(rank)) })),
    plot: { left: box.left, right: r(box.width - box.right), top: box.top, bottom: r(box.height - box.bottom) },
  };
}

type Ranked = { team: string; rating: number; was?: number | null };
export type Move = { team: string; place: number; before: number; places: number; change: number };

/** The teams that moved most in the table's order of ranked teams (`ranked`, best first) given `moved` (lib/ratings.ts
 * `movement`: places gained, so +3 is up three; 0 when the rating moved by the threshold or less; "new" for a team unrated a
 * week ago). Risers and fallers each biggest first, `n` at most; a team that did not move, or is new, is in neither. */
export function biggestMovers(ranked: Ranked[], moved: Map<string, number | "new"> | undefined, n = 3): { risers: Move[]; fallers: Move[] } {
  const moves = ranked.flatMap((r, i): Move[] => {
    const places = moved?.get(r.team);
    if (typeof places !== "number" || places === 0 || r.was == null) return [];
    return [{ team: r.team, place: i + 1, before: i + 1 + places, places, change: r.rating - r.was }];
  });
  return {
    risers: moves.filter((m) => m.places > 0).sort((a, b) => b.places - a.places || b.change - a.change || a.team.localeCompare(b.team)).slice(0, n),
    fallers: moves.filter((m) => m.places < 0).sort((a, b) => a.places - b.places || a.change - b.change || a.team.localeCompare(b.team)).slice(0, n),
  };
}
