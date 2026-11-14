import type { Box } from "./data";

/** The two lines under a box's teams (ADR 0049), shared by the page and the full-size image: the result or the projected
 * margin, then the kickoff of a game not yet played. The site ("Sterling City High School, Sterling City") is too long
 * for a box; it is in the box's title and on the game page. `max`: the characters that fit on a line. The page tests
 * check that nothing in a box is cut short. */
export function boxLines(b: Box, max = Infinity): [string, string] {
  if (b.state === "final") return [b.forfeit ? "Forfeit" : "Final", ""];
  if (b.state === "disputed") return ["Final · Disputed", ""];
  if (b.state === "bye") return ["Bye", ""];
  const margin = b.projection?.margin;
  // "Harvest Christian Academy-Keller by 4" is too long for one line of a box: the margin alone, the chances on the team
  // rows above saying whose it is.
  const first = !margin ? (b.state === "open" ? "Not listed yet" : "Not played yet") : margin.length <= max ? margin : `Projected margin ${margin.slice(margin.lastIndexOf(" by ") + 4)}`;
  return [first, b.time ?? ""];
}

/** About how wide a line of Barlow Condensed is, in pixels: its letters average about 0.42 of the font size; erring wide. */
export const lineWidth = (text: string, size: number) => text.length * size * 0.46;

/**
 * A name in a box `width` wide and `height` tall, never cut mid-word: one line at `size`, or up to three pixels smaller,
 * when it fits; else two lines, split at the space that makes the longer line shortest, as large as fit; else (a name too
 * long even for that) its short form: the words before any parenthesis, then as many whole words as fit on one line.
 */
export function fitName(text: string, width: number, height: number, size: number): { lines: string[]; size: number } {
  for (let s = size; s >= Math.max(12, size - 3); s--) if (lineWidth(text, s) <= width) return { lines: [text], size: s };
  const words = text.split(" ");
  if (words.length > 1) {
    const splits = words.slice(1).map((_, i) => [words.slice(0, i + 1).join(" "), words.slice(i + 1).join(" ")]);
    const lines = splits.reduce((best, l) => (Math.max(l[0].length, l[1].length) < Math.max(best[0].length, best[1].length) ? l : best));
    for (let s = Math.min(size, Math.floor(height / 2.1)); s >= 10; s--) if (lines.every((l) => lineWidth(l, s) <= width)) return { lines, size: s };
  }
  const short = text.replace(/\s*\(.*$/, "").split(" ");
  while (short.length > 1 && lineWidth(short.join(" "), size) > width) short.pop();
  return { lines: [short.join(" ")], size };
}
