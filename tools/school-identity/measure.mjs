// Measuring and editing helpers for stored logos (ADR 0016): where the mark really is inside its canvas, whether a
// solid background box surrounds it, and whether it is a light mark that needs a dark tile.
// Shared by fetch-logos.mjs (edits and flags) and audit-logos.mjs (the report). Takes a loaded `sharp`.

const BG_TOLERANCE = 28; // per channel, how far a pixel may be from the background color and still count as it
const CLEAR_ALPHA = 24; // below this a pixel counts as transparent
const TRIM_BELOW = 0.85; // a mark filling less of its canvas than this gets its padding trimmed

/** Raw RGBA of an image, at most `max` px on the long side (measuring needs no more). */
async function rgba(sharp, input, max = 400) {
  const img = sharp(input).ensureAlpha();
  const { data, info } = await img.resize(max, max, { fit: "inside", withoutEnlargement: true }).raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

const near = (data, i, bg) =>
  Math.abs(data[i] - bg[0]) <= BG_TOLERANCE && Math.abs(data[i + 1] - bg[1]) <= BG_TOLERANCE && Math.abs(data[i + 2] - bg[2]) <= BG_TOLERANCE;

/** The one solid color the four corners agree on (opaque), or null. A box of it around a mark is a "background". */
function cornerColor({ data, width, height }) {
  const at = (x, y) => {
    const i = (y * width + x) * 4;
    return [data[i], data[i + 1], data[i + 2], data[i + 3]];
  };
  const corners = [at(0, 0), at(width - 1, 0), at(0, height - 1), at(width - 1, height - 1)];
  if (corners.some((c) => c[3] < 200)) return null;
  const [first, ...rest] = corners;
  const agree = rest.every((c) => Math.abs(c[0] - first[0]) <= BG_TOLERANCE && Math.abs(c[1] - first[1]) <= BG_TOLERANCE && Math.abs(c[2] - first[2]) <= BG_TOLERANCE);
  return agree ? first.slice(0, 3) : null;
}

/**
 * Where the mark is: its bounding box among pixels that are neither transparent nor the corner background color.
 * `solidBackground` is true when an opaque background color surrounds the mark (so it must be stripped for a clear
 * logo). `fill` is the box's share of the canvas area.
 */
export async function measure(sharp, input) {
  const img = await rgba(sharp, input);
  const { data, width, height } = img;
  const bg = cornerColor(img);
  let x0 = width, y0 = height, x1 = -1, y1 = -1, opaque = 0, bgPixels = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      if (data[i + 3] < CLEAR_ALPHA) continue;
      opaque += 1;
      if (bg && near(data, i, bg)) { bgPixels += 1; continue; }
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return { empty: true, width, height, bg, fill: 0, box: null, solidBackground: false };
  const boxW = x1 - x0 + 1, boxH = y1 - y0 + 1;
  return {
    empty: false,
    width,
    height,
    bg,
    solidBackground: Boolean(bg) && bgPixels / (width * height) > 0.005,
    box: { x0: x0 / width, y0: y0 / height, x1: (x1 + 1) / width, y1: (y1 + 1) / height },
    fill: (boxW * boxH) / (width * height),
    widthFill: boxW / width,
    heightFill: boxH / height,
  };
}

/**
 * True when the mark would be hard to see on the white tile, so the site draws a dark one: on a clear background, a good
 * part of the mark is washed out against white (luminance over 200, 40% or more) and little of it is strong (under 110, under 15%). A white mark
 * with a dark outline, or a dark mark with white inside, stays on white.
 */
export async function isLightOnClear(sharp, input) {
  const { data } = await sharp(input).resize(48, 48, { fit: "contain", background: "#0000" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let clear = 0, solid = 0, washed = 0, strong = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) { clear += 1; continue; }
    solid += 1;
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    if (lum > 200) washed += 1;
    else if (lum < 110) strong += 1;
  }
  return solid > 0 && clear / (clear + solid) > 0.2 && washed / solid > 0.4 && strong / solid < 0.15;
}

/**
 * Edits a raster so the mark sits snug in its canvas: strips a solid background (flood from the edges, so enclosed
 * areas of the same color inside the mark survive), then trims transparent padding, leaving a small margin.
 * Returns { buffer, notes } where notes lists what was done (empty when nothing needed doing).
 */
export async function tidy(sharp, input, { margin = 0.02, keepBackground = false } = {}) {
  const notes = [];
  const m = await measure(sharp, input);
  if (m.empty) return { buffer: null, notes: ["image is blank"] };
  let buffer = await sharp(input).ensureAlpha().png().toBuffer();
  if (m.solidBackground && m.bg && !keepBackground) {
    buffer = await stripBackground(sharp, buffer, m.bg);
    notes.push(`stripped the solid background (a ${m.bg.map((v) => v.toString(16).padStart(2, "0")).join("")} box around the mark)`);
  }
  if (m.fill < TRIM_BELOW || (m.solidBackground && !keepBackground)) {
    const trimmed = await trimClear(sharp, buffer, margin);
    if (trimmed.changed) {
      buffer = trimmed.buffer;
      notes.push(`trimmed padding (the mark filled ${Math.round(m.fill * 100)}% of the canvas)`);
    }
  }
  return { buffer, notes };
}

/** Makes the background color connected to the image edges transparent (flood fill), with a soft one-pixel edge. */
export async function stripBackground(sharp, input, bg) {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const seen = new Uint8Array(width * height);
  const stack = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const p = y * width + x;
    if (seen[p]) return;
    const i = p * 4;
    if (data[i + 3] >= CLEAR_ALPHA && !near(data, i, bg)) return;
    seen[p] = 1;
    stack.push(p);
  };
  for (let x = 0; x < width; x += 1) { push(x, 0); push(x, height - 1); }
  for (let y = 0; y < height; y += 1) { push(0, y); push(width - 1, y); }
  while (stack.length) {
    const p = stack.pop();
    const x = p % width, y = (p - x) / width;
    push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
  }
  for (let p = 0; p < seen.length; p += 1) if (seen[p]) data[p * 4 + 3] = 0;
  return sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

/** Crops transparent padding away (and leaves `margin` of the longer side). */
export async function trimClear(sharp, input, margin = 0.02) {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] < CLEAR_ALPHA) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return { buffer: input, changed: false };
  const pad = Math.round(Math.max(x1 - x0, y1 - y0) * margin);
  const left = Math.max(0, x0 - pad), top = Math.max(0, y0 - pad);
  const right = Math.min(width, x1 + 1 + pad), bottom = Math.min(height, y1 + 1 + pad);
  const changed = left > 0 || top > 0 || right < width || bottom < height;
  const buffer = await sharp(data, { raw: { width, height, channels: 4 } })
    .extract({ left, top, width: right - left, height: bottom - top })
    .png()
    .toBuffer();
  return { buffer, changed };
}
