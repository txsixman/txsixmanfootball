import { ORGS, orgBySlug } from "@/lib/orgs";
import { loadResultsText } from "@/lib/results-text-load";
import { loadWeeks, resultSeasons } from "@/lib/weeks";

// One results week as a plain-text file (ADR 0102), at /results/text/<season>/<week>/<org> (UIL is `uil` here, though its page has
// no organization in its address). For a paper or a radio station to print or read: kept out of search results, since the week's
// own page is what a search should find. Only a week with a game has one.
export const dynamic = "force-static";
export const dynamicParams = false;

export async function generateStaticParams() {
  const per = await Promise.all(
    ORGS.map(async (org) =>
      (await Promise.all((await resultSeasons(org)).map(async (season) => (await loadWeeks(season, org)).filter((w) => w.games.length).map((w) => ({ season: String(season), week: String(w.number), org: org.slug }))))).flat(),
    ),
  );
  return per.flat();
}

export async function GET(_request: Request, { params }: { params: Promise<{ season: string; week: string; org: string }> }) {
  const { season, week, org } = await params;
  const found = orgBySlug(org);
  const text = found && /^\d+$/.test(season) && /^\d+$/.test(week) ? await loadResultsText(found, Number(season), Number(week)) : undefined;
  if (!text) return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  return new Response(text, { headers: { "Content-Type": "text/plain; charset=utf-8", "X-Robots-Tag": "noindex" } });
}
