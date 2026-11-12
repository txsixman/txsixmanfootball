import { slugify } from "@/lib/slug";

// A program's rank within its organization at the end of each week of the season, one line (1 at the top). Server-rendered SVG: each
// point carries a native tooltip, and a table under it gives the same numbers to screen readers. The viewBox is about a
// phone's width and the drawing stops growing at 480px, so labels stay near 14 to 20px wherever it is seen.

export type TrendPoint = { week: string; rank: number; of: number };

const W = 400;
const H = 140;
const PAD = { top: 20, right: 46, bottom: 28, left: 12 };

const short = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export function RankTrend({ points, color = "var(--color-navy, #0a2a5e)" }: { points: TrendPoint[]; color?: string }) {
  const ranks = points.map((p) => p.rank);
  const [best, worst] = [Math.min(...ranks), Math.max(...ranks)];
  const span = Math.max(worst - best, 4);
  const top = Math.max(1, best - Math.round(span * 0.15));
  const bottom = worst + Math.round(span * 0.15);
  const x = (i: number) => PAD.left + (i * (W - PAD.left - PAD.right)) / Math.max(points.length - 1, 1);
  const y = (rank: number) => PAD.top + ((rank - top) * (H - PAD.top - PAD.bottom)) / Math.max(bottom - top, 1);
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.rank).toFixed(1)}`).join(" ");
  const first = points[0];
  const last = points.at(-1)!;
  const summary = `Rank in its organization from #${first.rank} in the week ending ${short(first.week)} to #${last.rank} in the week ending ${short(last.week)}; best #${best}.`;

  return (
    <figure className="px-3 pt-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full max-w-[480px]" role="img" aria-label={summary}>
        {[top, bottom].map((r) => (
          <g key={r}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(r)} y2={y(r)} stroke="var(--color-line, #d9dee8)" strokeWidth={1} />
            <text x={W - PAD.right + 6} y={y(r) + 5} fontSize={16} fill="var(--color-muted, #5b6475)">
              #{r}
            </text>
          </g>
        ))}
        <path d={line} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => (
          <g key={p.week}>
            <circle cx={x(i)} cy={y(p.rank)} r={4} fill={color} stroke="#fff" strokeWidth={2} />
            {/* A larger, invisible target carries the tooltip. */}
            <circle cx={x(i)} cy={y(p.rank)} r={12} fill="transparent">
              <title>{`Week ending ${short(p.week)}: #${p.rank} of ${p.of}`}</title>
            </circle>
          </g>
        ))}
        <text x={x(points.length - 1) + 8} y={y(last.rank) - 9} fontSize={17} fontWeight={700} fill="var(--color-ink, #111827)">
          #{last.rank}
        </text>
        <text x={PAD.left} y={H - 7} fontSize={16} fill="var(--color-muted, #5b6475)">
          {short(first.week)}
        </text>
        <text x={W - PAD.right} y={H - 7} fontSize={16} textAnchor="end" fill="var(--color-muted, #5b6475)">
          {short(last.week)}
        </text>
      </svg>
      <figcaption aria-hidden="true" className="pb-1 text-[13px] text-muted">{summary}</figcaption>
      <table className="sr-only">
        <caption>Rank in its organization by week</caption>
        <thead>
          <tr>
            <th scope="col">Week ending</th>
            <th scope="col">Rank</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.week}>
              <td>{short(p.week)}</td>
              <td>
                #{p.rank} of {p.of}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/** A team's place at the end of each week among the teams of its own organization (`sameOrg`: their slugs), from a
 * season table's `weeks` and `trend` (run.py --season). */
export function rankTrend(table: { weeks?: string[]; teams: { team: string; trend?: (number | null)[] }[] }, team: string, sameOrg: Set<string>): TrendPoint[] {
  return (table.weeks ?? []).flatMap((week, i) => {
    const rated = table.teams.filter((t) => t.trend?.[i] != null && sameOrg.has(slugify(t.team))).sort((a, b) => b.trend![i]! - a.trend![i]! || a.team.localeCompare(b.team));
    const at = rated.findIndex((t) => t.team === team);
    return at < 0 ? [] : [{ week, rank: at + 1, of: rated.length }];
  });
}
