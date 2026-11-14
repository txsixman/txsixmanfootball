// A program's final rating of each season, as one plain SVG line drawn on the server: no chart library and no client code.
// The drawing is one image with a summary for its label; a caption says the same, and a table gives every number to
// screen readers. A season with no rating breaks the line (a gap, never a guess).
import { lineChart } from "@/lib/line-chart";
import { signed } from "@/lib/signed";

export type SeasonRating = { season: number; rating: number | null };

// About a phone's width at 16px text (the viewBox stops growing at 480px, as in rating-chart.tsx), so labels stay near 14 to 19px wherever it is seen.
const BOX = { width: 400, height: 170, left: 56, right: 26, top: 12, bottom: 30 };

export function SeasonRatings({ points }: { points: SeasonRating[] }) {
  const have = points.filter((p) => p.rating != null);
  const first = have[0];
  const last = have.at(-1)!;
  const best = have.reduce((a, b) => (b.rating! > a.rating! ? b : a));
  const missing = points.length - have.length;
  const summary = `Final rating of each season, from ${signed(first.rating!)} in ${first.season} to ${signed(last.rating!)} in ${last.season}; highest ${signed(best.rating!)} in ${best.season}.${
    missing ? ` ${missing === 1 ? "One season has" : `${missing} seasons have`} no rating.` : ""
  } Zero is an average team.`;
  const chart = lineChart(points.map((p) => ({ x: p.season, y: p.rating })), BOX);
  return (
    <figure className="px-3 pt-2">
      <svg role="img" aria-label={summary} viewBox={`0 0 ${BOX.width} ${BOX.height}`} className="block h-auto w-full max-w-[480px]" fontSize="16">
        {chart.yTicks.map((t) => (
          <g key={t.value}>
            <line x1={chart.plot.left} x2={chart.plot.right} y1={t.cy} y2={t.cy} className="stroke-line" strokeWidth={1} />
            <text x={chart.plot.left - 6} y={t.cy} textAnchor="end" dominantBaseline="middle" className="fill-muted">
              {signed(t.value)}
            </text>
          </g>
        ))}
        {chart.zeroY != null && <line x1={chart.plot.left} x2={chart.plot.right} y1={chart.zeroY} y2={chart.zeroY} className="stroke-muted" strokeWidth={1} />}
        {chart.runs.map((run) => (
          <polyline key={run} points={run} fill="none" className="stroke-navy" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {chart.dots.map((d) => (
          <circle key={d.x} cx={d.cx} cy={d.cy} r={3.5} className="fill-navy stroke-page" strokeWidth={1} />
        ))}
        {chart.xTicks.map((t) => (
          <text key={t.x} x={t.cx} y={BOX.height - 8} textAnchor="middle" className="fill-muted">
            {t.x}
          </text>
        ))}
      </svg>
      <figcaption className="text-[13px] text-muted">{summary}</figcaption>
      <table className="sr-only">
        <caption>Final rating by season</caption>
        <thead>
          <tr>
            <th scope="col">Season</th>
            <th scope="col">Rating</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.season}>
              <td>{p.season}</td>
              <td>{p.rating == null ? "No rating" : signed(p.rating)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
