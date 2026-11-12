// The scorecard's plot: for each band of the favorite's win probability, how often the favorite won, regular season
// against playoffs, drawn with Observable Plot on the server (as app/programs/rating-chart.tsx): the page ships the
// finished SVG and no chart code. The diagonal is "the ratings exactly right". One image with one label; the tables
// beside it give every number. Colors are the site's tokens; the two series differ in shape as well as color.
import * as Plot from "@observablehq/plot";
import { parseHTML } from "linkedom";

export type ChartSeries = { label: string; points: { said: number; happened: number; games: number }[] };

const pct = (n: number) => `${Math.round(n * 100)}%`;

function chart(series: ChartSeries[]): { svg: string; summary: string } {
  const summary = `Each point is a band of games: the chance the ratings gave the favorite (across) against how often the favorite won (up), for ${series.map((s) => s.label.toLowerCase()).join(" and ")}. Points on the dotted diagonal mean the ratings were exactly right.`;
  const data = series.flatMap((s) => s.points.map((p) => ({ ...p, series: s.label })));
  const { document } = parseHTML("<!doctype html><html><body></body></html>");
  const svg = Plot.plot({
    document: document as unknown as Document,
    width: 400,
    height: 300,
    marginLeft: 52,
    marginBottom: 44,
    marginRight: 28,
    ariaLabel: summary,
    style: { fontFamily: "var(--font-sans)", fontSize: "14px", color: "var(--color-muted)", background: "transparent" },
    x: { label: "Chance the ratings gave the favorite", domain: [0.5, 1], grid: true, tickFormat: pct, ticks: 5 },
    y: { label: "Share of favorites that won", domain: [0.4, 1], grid: true, tickFormat: pct, ticks: 6 },
    marks: [
      Plot.line([[0.5, 0.5], [1, 1]], { stroke: "var(--color-muted)", strokeDasharray: "2 4", strokeWidth: 1.5 }),
      Plot.line(data.filter((d) => d.series === series[0].label), { x: "said", y: "happened", stroke: "var(--color-navy)", strokeWidth: 2 }),
      Plot.line(data.filter((d) => d.series !== series[0].label), { x: "said", y: "happened", stroke: "var(--color-red)", strokeWidth: 2 }),
      Plot.dot(data.filter((d) => d.series === series[0].label), { x: "said", y: "happened", symbol: "circle", fill: "var(--color-navy)", stroke: "white", r: 4 }),
      Plot.dot(data.filter((d) => d.series !== series[0].label), { x: "said", y: "happened", symbol: "diamond", fill: "white", stroke: "var(--color-red)", strokeWidth: 2, r: 5 }),
    ],
  });
  svg.setAttribute("role", "img");
  // One label for the whole image: Plot also labels its inner groups, which have no role and which axe rejects.
  for (const el of svg.querySelectorAll("[aria-label], [aria-description]")) {
    el.removeAttribute("aria-label");
    el.removeAttribute("aria-description");
  }
  svg.setAttribute("style", `${svg.getAttribute("style") ?? ""};width:100%;max-width:480px;height:auto;display:block`);
  return { svg: svg.outerHTML, summary };
}

export function ScorecardChart({ series }: { series: ChartSeries[] }) {
  const { svg, summary } = chart(series);
  return (
    <figure className="mt-3">
      {/* Plot's own SVG, made on the server from the backtest file: no outside input reaches it. */}
      <div dangerouslySetInnerHTML={{ __html: svg }} />
      <figcaption className="text-[13px] text-muted">
        <span className="font-bold text-navy">● {series[0].label}</span> <span className="font-bold text-red">◇ {series[1].label}</span> · dotted diagonal: the ratings exactly right. {summary}
      </figcaption>
      {/* The wrapper clips the table: a bare absolutely placed table can widen the page on a phone. */}
      <div className="sr-only">
        <table>
          <caption>Chance said and share that won, by band, for each group of games</caption>
          <thead>
            <tr>
              <th scope="col">Group</th>
              <th scope="col">Chance said</th>
              <th scope="col">Favorite won</th>
              <th scope="col">Games</th>
            </tr>
          </thead>
          <tbody>
            {series.flatMap((s) =>
              s.points.map((p) => (
                <tr key={`${s.label}-${p.said}`}>
                  <td>{s.label}</td>
                  <td>{pct(p.said)}</td>
                  <td>{pct(p.happened)}</td>
                  <td>{p.games}</td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
