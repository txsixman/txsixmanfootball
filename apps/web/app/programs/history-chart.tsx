// A program's season told week by week: its rank among its organization's teams and its rating, as one plain SVG drawn on
// the server (ADR 0091): no chart library and no client code. The drawing is one image with a summary for its label; the
// same sentence sits under it and a table gives every number to screen readers. A week the team was not ranked breaks the
// rank line (a gap, never a guess). The viewBox is about a phone's width and the drawing stops growing at 480px, so labels
// stay near 14 to 19px wherever it is seen.
import { lineChart } from "@/lib/line-chart";
import { historySummary, rankChart, weekLabel, type HistoryPoint } from "@/lib/rank-history";
import { signed } from "@/lib/signed";

const W = 400;
const PANEL = { height: 94, top: 8, bottom: 8, left: 64, right: 14 };
const TITLE = 20; // room for a panel's title above it
const GAP = 14;

export function HistoryChart({ points, label, color = "var(--color-navy)", note }: { points: HistoryPoint[]; label: string; color?: string; note?: string }) {
  const ranked = points.filter((p) => p.rank != null).length >= 2;
  const box = { width: W, ...PANEL };
  const x = (i: number) => i;
  const rating = lineChart(points.map((p, i) => ({ x: x(i), y: p.rating })), box);
  const rank = ranked ? rankChart(points.map((p, i) => ({ x: x(i), y: p.rank })), box) : undefined;
  const rankTop = TITLE;
  const ratingTop = rankTop + (rank ? PANEL.height + GAP + TITLE : 0);
  const height = ratingTop + PANEL.height + 30;
  const summary = historySummary(points, label);
  const first = points[0];
  const last = points.at(-1)!;
  return (
    <figure className="px-3 pt-2">
      <svg role="img" aria-label={summary} viewBox={`0 0 ${W} ${height}`} className="block h-auto w-full max-w-[480px]" fontSize="16">
        {rank && (
          <g>
            <text x={12} y={rankTop - 6} fontWeight={700} className="fill-ink">
              Rank in {label} (1 is best)
            </text>
            <g transform={`translate(0 ${rankTop})`}>
              {rank.yTicks.map((t) => (
                <g key={t.rank}>
                  <line x1={rank.plot.left} x2={rank.plot.right} y1={t.cy} y2={t.cy} className="stroke-line" strokeWidth={1} />
                  <text x={rank.plot.left - 6} y={t.cy} textAnchor="end" dominantBaseline="middle" className="fill-muted">
                    #{t.rank}
                  </text>
                </g>
              ))}
              {rank.runs.map((run) => (
                <polyline key={run} points={run} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
              ))}
              {rank.dots.map((d) => (
                <circle key={d.x} cx={d.cx} cy={d.cy} r={3.5} fill={color} className="stroke-page" strokeWidth={1.5} />
              ))}
            </g>
          </g>
        )}
        <text x={12} y={ratingTop - 6} fontWeight={700} className="fill-ink">
          Rating (0 is an average team)
        </text>
        <g transform={`translate(0 ${ratingTop})`}>
          {rating.yTicks.map((t) => (
            <g key={t.value}>
              <line x1={rating.plot.left} x2={rating.plot.right} y1={t.cy} y2={t.cy} className="stroke-line" strokeWidth={1} />
              <text x={rating.plot.left - 6} y={t.cy} textAnchor="end" dominantBaseline="middle" className="fill-muted">
                {signed(t.value)}
              </text>
            </g>
          ))}
          {rating.zeroY != null && <line x1={rating.plot.left} x2={rating.plot.right} y1={rating.zeroY} y2={rating.zeroY} className="stroke-muted" strokeWidth={1} />}
          {rating.runs.map((run) => (
            <polyline key={run} points={run} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
          ))}
          {rating.dots.map((d) => (
            <circle key={d.x} cx={d.cx} cy={d.cy} r={3.5} fill={color} className="stroke-page" strokeWidth={1.5} />
          ))}
        </g>
        <text x={PANEL.left} y={height - 8} className="fill-muted">
          {weekLabel(first.week)}
        </text>
        <text x={W - PANEL.right} y={height - 8} textAnchor="end" className="fill-muted">
          {weekLabel(last.week)}
        </text>
      </svg>
      <figcaption aria-hidden="true" className="pb-1 text-[13px] text-muted">
        {summary}
        {note && ` ${note}`}
      </figcaption>
      <table className="sr-only">
        <caption>Rank and rating by week</caption>
        <thead>
          <tr>
            <th scope="col">Week ending</th>
            <th scope="col">Rank</th>
            <th scope="col">Rating</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.week}>
              <td>{weekLabel(p.week)}</td>
              <td>{p.rank == null ? "Not ranked" : `#${p.rank} of ${p.of}`}</td>
              <td>{signed(p.rating)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
