import fold from "./fold.json" with { type: "json" };
import list from "./wordlist.json" with { type: "json" };

// Twin of moderation_normalize() and the checks in packages/db/migrations/0013_moderation.sql: change both together. The shared
// test vectors (vectors.json, run by scripts/moderation.test.mjs and packages/db/test/moderation.test.mjs) fail if they drift.
//
// What a post may not say or contain, checked before it is saved (ADR 0018). The database checks the same rules again
// (post_text_check in migration 0013, same terms in moderation_term): this copy gives the fan a clear answer without a
// round trip, and the database copy is the one that cannot be skipped.

// Text is folded to plain lowercase words so a spelling trick does not get past the word list: compatibility forms
// (fullwidth letters, ligatures; NFKD), accents and other combining marks, invisible and direction-changing characters,
// Cyrillic and Greek look-alikes (fold.json), look-alike digits and symbols (n1gg3r, @ss; not "!", which ends
// sentences), stretched letters (niggggger) and separators (n.i.g.g.e.r).
const FOLD = new Map([...fold.from].map((c, i) => [c, fold.to[i]]));

// Combining marks, zero-width, soft-hyphen, bidi and variation-selector characters, the Hangul and Khmer fillers.
// Dropped, not turned into spaces, so n\u200Bigger is still one word. Twin of the class in moderation_strip().
const INVISIBLE = /['\u2019\u00ad\u061c\u0300-\u036f\u034f\u115f\u1160\u17b4\u17b5\u180b-\u180e\u1ab0-\u1aff\u1dc0-\u1dff\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u206f\u20d0-\u20ff\ufe00-\ufe0f\ufe20-\ufe2f\u3164\ufeff\ufff9-\ufffb\u{e0000}-\u{e007f}\u{e0100}-\u{e01ef}]/gu;

/** NFKD, lower case, apostrophes and invisible characters dropped; nothing else changed. Twin of moderation_strip(). */
export function strip(text: string): string {
  return text.normalize("NFKD").toLowerCase().replace(INVISIBLE, "");
}

export function normalize(text: string): string {
  // Look-alikes are turned into letters before lower-casing, so an upper-case Greek N and a lower-case one need no help from the locale.
  const folded = strip([...text.normalize("NFKD")].map((c) => FOLD.get(c) ?? c).join(""));
  return folded
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/([a-z0-9])\1{2,}/g, "$1$1")
    .trim();
}

export type TextProblem = "bad_text" | "blocked_text" | "links_not_allowed" | "too_many_links";

const MAX_POST_LENGTH = 2000;
export const MAX_TITLE_LENGTH = 120;
const MAX_LINKS = 2;
/** An account younger than this may not post links, and has tighter rate limits (ADR 0018). */
export const NEW_ACCOUNT_DAYS = 7;

const THREATS = list.threat.map((p) => new RegExp(p));

/** True when the text holds a slur from the open list or matches a threat pattern. */
export function isBlocked(text: string): boolean {
  const n = normalize(text);
  if (!n) return false;
  const padded = ` ${n} `;
  const squashed = n.replace(/ /g, "");
  return (
    list.word.some((w) => padded.includes(` ${w} `) || (!w.includes(" ") && padded.includes(` ${[...w].join(" ")} `))) ||
    list.squash.some((w) => squashed.includes(w)) ||
    THREATS.some((t) => t.test(padded))
  );
}

// Every address in a post, counted over the whole text (not word by word, so a bracket, a colon, an apostrophe or a
// no-break space cannot hide one): a scheme and what follows up to a space, quote or angle bracket; a www. name; a bare
// name ending in a common domain suffix; "dot com" spelled out. The same pattern finds the links the page makes
// clickable (splitLinks); twin of post_link_count() in migration 0013.
const LINK =
  /(?:(?:https?|ftp):\/\/[^\s<>"']+|www\.[^\s<>"']+|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|edu|gov|io|co|us|tv|me|ly|gg|xyz|info|app|dev|link|to|ms|cc|ru|cn|biz|site|online|shop|store|club|live|fun|top|ai|tk|ml|ga|cf|gq|ws|vip|cloud)(?![a-z0-9])|\sdot\s(?:com|net|org)(?![a-z0-9]))/gi;

// Spaces that are not the plain one, turned into it one for one (so positions hold): no-break, the en/em family, thin,
// narrow no-break, medium mathematical, ideographic, next line, line and paragraph separators, byte order mark.
const SPACES = /[\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]/g;
const spaced = (text: string) => text.replace(SPACES, " ");

export function linkCount(text: string): number {
  return [...spaced(text).matchAll(LINK)].length;
}

/** A post cut into plain text and the http(s) addresses in it, each with its href. A trailing full stop, comma or bracket is not part of an address. */
export function splitLinks(text: string): { text: string; href?: string }[] {
  const out: { text: string; href?: string }[] = [];
  let last = 0;
  const push = (t: string, href?: string) => t && out.push(href ? { text: t, href } : { text: t });
  for (const m of spaced(text).matchAll(LINK)) {
    if (!/^https?:/i.test(m[0])) continue;
    const raw = text.slice(m.index, m.index + m[0].length);
    const trimmed = raw.replace(/[.,;:!?)\]}]+$/, "");
    let href: string;
    try {
      const u = new URL(trimmed);
      if (u.protocol !== "http:" && u.protocol !== "https:") continue;
      href = u.href;
    } catch {
      continue;
    }
    push(text.slice(last, m.index));
    push(trimmed, href);
    last = m.index + trimmed.length;
  }
  push(text.slice(last));
  return out;
}

/** The first reason a post body is refused, or null when it may be posted. `established`: the account is older than 7 days. */
export function checkText(raw: string, { established, max = MAX_POST_LENGTH }: { established: boolean; max?: number }): TextProblem | null {
  const text = raw.trim();
  // Control characters and direction-changing ones (U+202A to U+202E, U+2066 to U+2069); nothing that folds to a letter or digit.
  // eslint-disable-next-line no-control-regex
  if (text.length === 0 || text.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u206f]/.test(text) || normalize(text) === "") return "bad_text";
  if (isBlocked(text)) return "blocked_text";
  const links = linkCount(text);
  // A new account gets no address of any kind: a scheme or www. anywhere, however spaced or hidden.
  if (!established && (links > 0 || /:\/\/|www\./.test(strip(text)))) return "links_not_allowed";
  if (links > MAX_LINKS) return "too_many_links";
  return null;
}
