import { stat } from "node:fs/promises";
import path from "node:path";
import { loadAlignments, uniquePrograms } from "@/lib/alignments";
import { embedCsp, renderEmbed, type EmbedCrest, type EmbedGame, type EmbedView } from "@/lib/embed-html";
import { loadGames, loadSeasonResults } from "@/lib/games";
import { EMPTY, loadIdentities, type Identity } from "@/lib/identity";
import { seasonRows, type Row } from "@/lib/program-games";
import { loadRanked } from "@/lib/rankings";
import { record } from "@/lib/ratings";
import { CURRENT_SEASON } from "@/lib/season";
import { tonightsDate } from "@/lib/tonight";
import { crestLogo, initials, logoCopy } from "@/app/programs/crest";

// The embeddable scoreboard (ADR 0023): a program's crest, record, last three results and next game as one small static HTML
// document for a school or booster site's iframe. A route handler, not a page, so it ships no framework script and sets its
// own headers: its Content-Security-Policy names the one inline script by hash (lib/embed-html.ts). Static like every page.
// It is the only route that may be framed (next.config.ts).
export const dynamic = "force-static";
export const dynamicParams = false;
export const generateStaticParams = async () => uniquePrograms(await loadAlignments()).map((a) => ({ slug: a.slug }));

/** The crest is drawn 48px high (a 96px, 2x copy). A logo whose copy is bigger than this is replaced by the badge, so the page and its crest stay under 30 KB:
 * only the SVG logos can be that big (the largest WebP copy is 12 KB). */
const CREST_SIZE = 48;
const MAX_LOGO_BYTES = 20_000;

async function crestFor(school: string, identity: Identity): Promise<EmbedCrest> {
  const logo = crestLogo(identity, 3); // the 288x96 copy fits an aspect of 3
  if (logo) {
    const src = logoCopy(logo, CREST_SIZE);
    // shortcut: the file is measured here, at build time; upgrade: the identity data carries each copy's size.
    const { size } = await stat(path.join(process.cwd(), "public", src));
    if (size <= MAX_LOGO_BYTES) {
      return { kind: "logo", src, width: Math.round(CREST_SIZE * Math.max(1, logo.aspect)), height: CREST_SIZE, tile: logo.light ? identity.theme.bg : "#ffffff" };
    }
  }
  const { bg, fg, stripe } = identity.theme;
  return { kind: "badge", text: initials(school), bg, fg, stripe };
}

const game = (r: Row): EmbedGame => ({ status: r.status, home: r.home, opponent: r.opponent, score: r.score, note: r.score ? undefined : r.note, playoff: r.playoff });

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const all = await loadAlignments();
  const school = all.find((a) => a.slug === slug);
  if (!school) return new Response("Not found", { status: 404 });
  const identity = (await loadIdentities()).get(slug) ?? EMPTY;
  // The same figures as the program page: the record is the rated team's (ADR 0013), the rows are the season's timeline.
  const ranked = (await loadRanked()).teams.find((t) => t.school.slug === slug);
  const { rows, next } = seasonRows(school.school, await loadGames(all), await loadSeasonResults(CURRENT_SEASON));
  const view: EmbedView = {
    slug,
    school: school.school,
    season: CURRENT_SEASON,
    crest: await crestFor(school.school, identity),
    band: identity.theme,
    record: ranked ? record(ranked) : null,
    recent: rows.filter((r) => r.score).slice(-3).reverse().map(game),
    next: next ? game(next) : null,
    nextWaiting: !!next && next.date < tonightsDate(),
  };
  return new Response(renderEmbed(view), {
    headers: { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": embedCsp() },
  });
}
