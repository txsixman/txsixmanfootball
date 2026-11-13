// The numbers behind a small line chart drawn as plain SVG on the server (app/programs/season-ratings.tsx): no chart
// library, no client code. Pure, so node tests it (scripts/program-history.test.mjs).

export type Box = { width: number; height: number; left: number; right: number; top: number; bottom: number };
/** `x`: a season. `y`: its value, or null where there is none (the line breaks there). */
export type SeriesPoint = { x: number; y: number | null };

/** Round tick values covering [min, max], about four steps apart. */
export function niceTicks(min: number, max: number): number[] {
  const [lo, hi] = min === max ? [min - 5, max + 5] : [min, max];
  const raw = (hi - lo) / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * mag >= raw) ?? 10) * mag;
  const start = Math.floor(lo / step + 1e-9);
  const count = Math.max(1, Math.ceil(hi / step - 1e-9) - start);
  return Array.from({ length: count + 1 }, (_, i) => Math.round((start + i) * step * 100) / 100);
}

/** Where everything goes in the drawing: runs of connected points (one polyline each), a dot for every point, the axis
 * ticks, and the zero line when zero is inside the drawing. Coordinates are rounded to a tenth. */
export function lineChart(points: SeriesPoint[], box: Box) {
  const known = points.filter((p): p is { x: number; y: number } => p.y != null);
  const ticks = niceTicks(Math.min(...known.map((p) => p.y)), Math.max(...known.map((p) => p.y)));
  const [yLo, yHi] = [ticks[0], ticks.at(-1)!];
  const [xLo, xHi] = [points[0].x, points.at(-1)!.x];
  const px = (x: number) => box.left + (xHi === xLo ? 0.5 : (x - xLo) / (xHi - xLo)) * (box.width - box.left - box.right);
  const py = (y: number) => box.top + (1 - (y - yLo) / (yHi - yLo)) * (box.height - box.top - box.bottom);
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
    dots: known.map((p) => ({ x: p.x, value: p.y, cx: r(px(p.x)), cy: r(py(p.y)) })),
    xTicks: points.map((p) => ({ x: p.x, cx: r(px(p.x)) })),
    yTicks: ticks.map((value) => ({ value, cy: r(py(value)) })),
    zeroY: yLo <= 0 && yHi >= 0 ? r(py(0)) : null,
    plot: { left: box.left, right: r(box.width - box.right), top: box.top, bottom: r(box.height - box.bottom) },
  };
}
