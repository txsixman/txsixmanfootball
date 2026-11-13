// The embeddable scoreboard's page (ADR 0023): one complete HTML document, built as a string at build time, with its own CSS
// and one tiny inline script, so the iframe a school puts on its site loads no framework code. Pure: it imports nothing, so
// the node tests can run it as it is.   node --test apps/web/scripts/
import { createHash } from "node:crypto";

/** The crest: the school's logo (a copy sized for it, ADR 0022) in its own tile, or a badge in its colors (ADR 0006). */
export type EmbedCrest =
  | { kind: "logo"; src: string; width: number; height: number; tile: string }
  | { kind: "badge"; text: string; bg: string; fg: string; stripe: string | null };

/** One game as the embed shows it: the program page's own row (lib/program-games.ts). `score` is already "Forfeit" for a forfeit. */
export type EmbedGame = { status: string; home: boolean; opponent: string; score: string | null; note?: string };

export type EmbedView = {
  slug: string;
  school: string;
  season: number;
  crest: EmbedCrest;
  /** The school's band colors (lib/identity.ts theme). */
  band: { bg: string; fg: string; stripe: string | null };
  /** The program page's record figure; null until the team is rated. */
  record: string | null;
  /** The last results, latest first. */
  recent: EmbedGame[];
  next: EmbedGame | null;
  /** The next game is dated before tonight: it is waiting on its score, not still to play. */
  nextWaiting?: boolean;
};

/** The program page the embed links to: absolute, because the embed is shown on another site. */
const SITE = "https://txsixmanfootball.com";

/** The iframe's height in pixels: the tallest of the 280 programs at 375px wide (548px: long opponent names wrap) with a few pixels to spare;
 * e2e/embed.spec.ts measures every program. */
export const EMBED_HEIGHT = 560;

/** The iframe a school pastes into its page (shown on the program page as text, never as an element). */
export const embedSnippet = (slug: string, school: string) =>
  `<iframe src="${SITE}/embed/programs/${encodeURIComponent(slug)}" title="${escapeHtml(school)} scores" width="100%" height="${EMBED_HEIGHT}" style="border:0" loading="lazy"></iframe>`;

/** `?theme=` is read from the address by this one script, which accepts only these three words and ignores anything else.
 * No `</script` may appear in it. */
export const THEME_SCRIPT = `(function(){var t=new URLSearchParams(location.search).get("theme");if(t==="light"||t==="dark"||t==="auto")document.documentElement.setAttribute("data-theme",t)})()`;

/** The page's Content-Security-Policy: no source but its own images, its own style and the one script, named by its hash. */
export const embedCsp = () =>
  [
    "default-src 'none'",
    `script-src 'sha256-${createHash("sha256").update(THEME_SCRIPT).digest("base64")}'`,
    "style-src 'unsafe-inline'",
    "img-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors *",
  ].join("; ");

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
/** Every interpolated value goes through this. */
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ESCAPES[c]);

/** A color goes into a style attribute, so only a plain hex color gets in. */
const color = (c: string | null, fallback: string) => (c && /^#[0-9a-f]{6}$/i.test(c) ? c : fallback);

const CSS = `
:root{color-scheme:light;--bg:#fff;--ink:#14181f;--muted:#4d5563;--line:#d9dde5;--link:#0a2a5e;--red:#b01b29}
@media(prefers-color-scheme:dark){:root:not([data-theme=light]){color-scheme:dark;--bg:#0d1523;--ink:#eef1f6;--muted:#aab3c2;--line:#2a3547;--link:#9fc2ff;--red:#ff8a93}}
:root[data-theme=dark]{color-scheme:dark;--bg:#0d1523;--ink:#eef1f6;--muted:#aab3c2;--line:#2a3547;--link:#9fc2ff;--red:#ff8a93}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.35 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}
.band{display:flex;align-items:center;gap:12px;padding:12px;border-bottom:6px solid}
.crest{display:inline-flex;flex:none;align-items:center;justify-content:center;padding:4px}
.crest img{display:block;width:100%;height:100%;object-fit:contain}
.badge{font-weight:700;line-height:1}
h1{margin:0;font-size:20px;line-height:1.1;text-transform:uppercase;letter-spacing:.02em;overflow-wrap:anywhere}
.rec{margin:2px 0 0;font-size:14px}
.rec b{font-size:20px;font-variant-numeric:tabular-nums}
h2{margin:0;padding:12px 12px 2px;font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--red)}
ul{margin:0;padding:0;list-style:none}
.g{display:grid;grid-template-columns:4.5rem 1fr auto;align-items:center;gap:0 12px;min-height:44px;padding:4px 12px;border-bottom:1px solid var(--line)}
.d{font-size:14px;font-weight:700;text-transform:uppercase;color:var(--link)}
.s{font-size:20px;font-variant-numeric:tabular-nums}
.n{grid-column:2/4;margin-top:-2px;font-size:13px;color:var(--muted)}
.fine{margin:0;padding:8px 12px 0;font-size:13px;color:var(--muted)}
footer{padding:4px 12px 8px}
a{display:inline-flex;align-items:center;min-height:44px;font-weight:600;color:var(--link)}
`.replace(/\n/g, "");

const gameRow = (g: EmbedGame) =>
  `<li class="g"><span class="d">${escapeHtml(g.status)}</span><span>${g.home ? "vs" : "at"} ${escapeHtml(g.opponent)}</span>` +
  `${g.score ? `<b class="s">${escapeHtml(g.score)}</b>` : "<span></span>"}${g.note ? `<span class="n">${escapeHtml(g.note)}</span>` : ""}</li>`;

const crestHtml = (c: EmbedCrest) =>
  c.kind === "logo"
    ? `<span class="crest" style="width:${c.width}px;height:${c.height}px;background:${color(c.tile, "#ffffff")}"><img src="${escapeHtml(c.src)}" width="${c.width}" height="${c.height}" alt=""></span>`
    : `<span class="crest badge" aria-hidden="true" style="width:48px;height:48px;font-size:20px;background:${color(c.bg, "#0a2a5e")};color:${color(c.fg, "#ffffff")}${c.stripe ? `;box-shadow:inset 0 -4px 0 ${color(c.stripe, "#bf1e2e")}` : ""}">${escapeHtml(c.text)}</span>`;

/** The whole document. Nothing in it names a source or a winner: a score reads as it does on the program page and a forfeit
 * says so (the row's `score` is "Forfeit"). */
export function renderEmbed(v: EmbedView): string {
  const school = escapeHtml(v.school);
  const href = `${SITE}/programs/${encodeURIComponent(v.slug)}`;
  const empty = !v.recent.length && !v.next;
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="robots" content="noindex"><meta name="color-scheme" content="light dark"><title>${school} scores | TX Six-Man Football</title>` +
    `<style>${CSS}</style><script>${THEME_SCRIPT}</script></head><body>` +
    `<header class="band" style="background:${color(v.band.bg, "#0a2a5e")};color:${color(v.band.fg, "#ffffff")};border-color:${color(v.band.stripe ?? v.band.bg, "#bf1e2e")}">` +
    `${crestHtml(v.crest)}<div><h1>${school}</h1>${v.record ? `<p class="rec"><b>${escapeHtml(v.record)}</b> ${v.season} record</p>` : ""}</div></header>` +
    `<main>${v.recent.length ? `<section aria-labelledby="r"><h2 id="r">Latest results</h2><ul>${v.recent.map(gameRow).join("")}</ul></section>` : ""}` +
    `${v.next ? `<section aria-labelledby="n"><h2 id="n">${v.nextWaiting ? "Score not in yet" : "Next game"}</h2><ul>${gameRow(v.next)}</ul></section>` : ""}` +
    `${empty ? `<p class="fine">No ${v.season} games on record yet.</p>` : ""}` +
    `${v.recent.length ? `<p class="fine">Scores are not confirmed here.</p>` : ""}</main>` +
    `<footer><a href="${escapeHtml(href)}" target="_blank" rel="noopener">Full schedule on TX Six-Man Football</a></footer></body></html>`
  );
}
