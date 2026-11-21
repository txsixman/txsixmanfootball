// Number-and-noun grammar for page text, so "1 point" never reads "1 points" and "an 11%" never reads "a 11%".

/** "1 point", "2 points", "0 points"; `many` for an irregular plural ("loss", "losses"). Thousands get a comma. */
export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** "a" or "an" for a number as it is said aloud: an 8, 11, 18, 80 to 89, 800 to 899, 8,000, 11,000, 18,000 and so on;
 * a 1, 7, 12, 100. Takes a number or its text ("11%", "1,800"); text that does not start with a digit (a chance capped as
 * "less than 1" or "greater than 99", lib/projection.ts) reads "a". A decimal is read by its whole part. */
export function aOrAn(n: number | string): "a" | "an" {
  const text = String(n).trim();
  const whole = /^\d[\d,]*/.exec(text)?.[0].replace(/,/g, "");
  if (!whole) return "a";
  if (whole.startsWith("8")) return "an";
  return (whole.startsWith("11") || whole.startsWith("18")) && whole.length % 3 === 2 ? "an" : "a";
}

const SINGULAR: Record<string, string> = { points: "point", games: "game", wins: "win", shutouts: "shutout", places: "place", meetings: "meeting" };

/** What a whole-number figure counts, read aloud: "points apart" is "point apart" beside a 1. Only the first plural noun changes
 * ("games of 60 points or more" is "game of 60 points or more"); any figure but a bare 1 leaves the unit as written. */
export const unitFor = (figure: unknown, unit: string) => (figure === 1 || figure === "1" ? unit.replace(/\b(?:points|games|wins|shutouts|places|meetings)\b/, (w) => SINGULAR[w]) : unit);
