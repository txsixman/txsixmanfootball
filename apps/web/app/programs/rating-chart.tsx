// A program's rating at the end of each week of the season, drawn with Observable Plot (ISC) on the server: Plot needs a
// DOM, so it gets linkedom's (ISC) and the page ships the finished SVG, no chart code. The SVG is one image with a
// summary for its label; a caption says the same, and a table under it gives every number to screen readers.
import * as Plot from "@observablehq/plot";
import { parseHTML } from "linkedom";
import { signed } from "@/lib/ratings";

export type RatingPoint = { week: string; rating: number };

/** A team's rating at the end of each week, from a season table's `weeks` and `trend` (run.py --season). */
export function ratingPoints(table: { weeks?: string[]; teams: { team: string; trend?: (number | null)[] }[] }, team: string): RatingPoint[] {
  const trend = table.teams.find((t) => t.team === team)?.trend ?? [];
  return (table.weeks ?? []).flatMap((week, i) => (trend[i] == null ? [] : [{ week, rating: trend[i]! }]));
}

const short = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** The chart's SVG markup and its one-sentence summary. */
function ratingChart(points: RatingPoint[]): { svg: string; summary: string } {
  const first = points[0];
  const last = points.at(-1)!;
  const best = points.reduce((a, b) => (b.rating > a.rating ? b : a));
  const summary = `Rating from ${signed(first.rating)} in the week ending ${short(first.week)} to ${signed(last.rating)} in the week ending ${short(last.week)}; highest ${signed(best.rating)}. Zero is an average team.`;
  const data = points.map((p) => ({ date: new Date(`${p.week}T12:00:00Z`), rating: p.rating }));
  const { document } = parseHTML("<!doctype html><html><body></body></html>");
  const svg = Plot.plot({
    document: document as unknown as Document,
    // About a phone's width, with 16px text, and the drawing stops growing at 480px (as in trend.tsx): labels stay
    // near 14 to 19px wherever it is seen, never the 7px a 600-wide drawing gives on a phone.
    width: 400,
    height: 160,
    marginLeft: 48,
    marginRight: 16,
    ariaLabel: summary,
    style: { fontFamily: "var(--font-sans)", fontSize: "16px", color: "var(--color-muted)", background: "transparent" },
    x: { type: "utc", label: null, ticks: 3, tickFormat: (d: Date) => short(d.toISOString().slice(0, 10)) },
    y: { label: "Rating", grid: true, nice: true, tickFormat: (v: number) => signed(v) },
    marks: [
      Plot.ruleY([0], { stroke: "var(--color-line)" }),
      Plot.line(data, { x: "date", y: "rating", stroke: "var(--color-navy)", strokeWidth: 2, curve: "monotone-x" }),
      Plot.dot(data, { x: "date", y: "rating", fill: "var(--color-navy)", stroke: "var(--color-page)", r: 3.5 }),
    ],
  });
  svg.setAttribute("role", "img");
  // The whole chart is one image with one label. Plot also labels its inner groups ("line", "dot"), which have no role;
  // axe rejects that (aria-prohibited-attr), and a screen reader gets the numbers from the table instead.
  for (const el of svg.querySelectorAll("[aria-label], [aria-description]")) {
    el.removeAttribute("aria-label");
    el.removeAttribute("aria-description");
  }
  svg.setAttribute("style", `${svg.getAttribute("style") ?? ""};width:100%;max-width:480px;height:auto;display:block`);
  return { svg: svg.outerHTML, summary };
}

export function RatingChart({ points }: { points: RatingPoint[] }) {
  const { svg, summary } = ratingChart(points);
  return (
    <figure className="px-3 pt-2">
      {/* Plot's own SVG, made on the server from the ratings file: no outside input reaches it. */}
      <div dangerouslySetInnerHTML={{ __html: svg }} />
      <figcaption className="text-[13px] text-muted">{summary}</figcaption>
      <table className="sr-only">
        <caption>Rating by week</caption>
        <thead>
          <tr>
            <th scope="col">Week ending</th>
            <th scope="col">Rating</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.week}>
              <td>{short(p.week)}</td>
              <td>{signed(p.rating)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
