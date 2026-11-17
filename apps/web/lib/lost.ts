// What the 404 page can guess a lost fan was after, from the address alone (app/not-found.tsx). Pure and import-free, so the
// browser, the build and scripts/lost.test.mjs share it. A school's page lives at /programs/<slug>, a game at /scores/<date>-<away>-vs-
// or -at-<home>, a series at /series/<a>/<b>: the words in those slugs are what the search can look for.
const KINDS = new Set(["programs", "scores", "series", "embed"]);
const MAX = 60;

/** The words to search for, or null when the address has none worth searching. Dates and round words are dropped from a
 * game's address, and "at" or "vs" between the two teams stay out of the way (the search reads two teams as it is). */
export function lostWords(pathname: string): string | null {
  const parts = pathname.split("/").filter(Boolean);
  let words: string[];
  try {
    words = parts.map((p) => decodeURIComponent(p));
  } catch {
    return null;
  }
  if (!KINDS.has(words[0] ?? "")) {
    // Any other address: its last piece, when it is made of letters (a school's name typed as an address).
    const last = words.at(-1) ?? "";
    return /^[a-z][a-z0-9-]*$/i.test(last) && last.length >= 3 ? last.replace(/-/g, " ").slice(0, MAX) : null;
  }
  const kind = words[0];
  const rest = kind === "embed" ? words.slice(2) : words.slice(1);
  const text = rest
    .join("-")
    .toLowerCase()
    .replace(/^\d{4}-\d{2}-\d{2}-/, "")
    .replace(/^\d{4}-(round-\d+|quarterfinal|semifinal|state-championship|final)-/, "")
    .replace(/-(at|vs)-/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return text.length >= 2 ? text.slice(0, MAX) : null;
}
