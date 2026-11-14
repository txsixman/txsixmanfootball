import { ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { heading, loadAlignments } from "@/lib/alignments";
import { finalScore, loadFinals } from "@/lib/champions";
import { seriesDescription } from "@/lib/descriptions";
import { playoffLabels, mediumDate } from "@/lib/game-pages";
import { gameKey } from "@/lib/games";
import { EMPTY, loadIdentities } from "@/lib/identity";
import { loadLineage } from "@/lib/lineage";
import { projectionParts, project } from "@/lib/projection";
import { loadRatings, ratingSeasons, record } from "@/lib/ratings";
import { finalsBetween, seriesRecord } from "@/lib/series";
import { loadSeries } from "@/lib/series-data";
import { Breadcrumbs } from "../../../breadcrumbs";
import { Crest } from "../../../programs/crest";
import { EdgeToEdge, SectionBar } from "../../../ui";
import { seriesTitle } from "@/lib/titles";

// The games of one pair of programs, FIRST_SEASON on (ADR 0013: records and scores may rest on unconfirmed robot-read results, so
// the page says so and no game row names a winner, ADR 0004). The address is the two program slugs in alphabetical order;
// the reversed address is not generated, so it answers 404 and the pair has one page.
type Props = { params: Promise<{ first: string; second: string }> };

export const dynamicParams = false;
export const generateStaticParams = async () => (await loadSeries()).map(({ first, second }) => ({ first, second }));

async function load({ first, second }: { first: string; second: string }) {
  const [series, alignments, seasons, table] = await Promise.all([loadSeries(), loadAlignments(), ratingSeasons(), loadRatings()]);
  const found = series.find((s) => s.first === first && s.second === second);
  const [a, b] = [alignments.find((x) => x.slug === first), alignments.find((x) => x.slug === second)];
  if (!found || !a || !b) return undefined;
  // Neutral field: the Matchup tool's own neutral button gives neither team the home edge. Undefined unless both are rated.
  const projection = project(table, a.school, b.school, true, true);
  return { ...found, a, b, since: seasons.at(-1)!, projection };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { first, second } = await params;
  const s = await load({ first, second });
  if (!s) return { title: "Series" };
  const labels = await Promise.all([...new Set(s.games.map((g) => g.season))].map(async (season) => [season, await playoffLabels(season)] as const));
  const labelOf = new Map(labels);
  const playoff = s.games.some(({ season, result: r }) => labelOf.get(season)?.has(gameKey(r.date, r.home, r.away)));
  return {
    title: seriesTitle({ first: s.a.school, second: s.b.school }),
    description: seriesDescription({ first: s.a.school, second: s.b.school, games: s.games.length, since: s.since, playoff, projection: s.projection !== undefined }),
    alternates: { canonical: `/series/${first}/${second}` },
  };
}

export default async function SeriesPage({ params }: Props) {
  const { first, second } = await params;
  const s = await load({ first, second });
  if (!s) notFound();
  const { a, b, games, since, projection } = s;
  const [identities, lineage, allFinals, labels] = await Promise.all([
    loadIdentities(),
    loadLineage(),
    loadFinals(),
    Promise.all([...new Set(games.map((g) => g.season))].map(async (season) => [season, await playoffLabels(season)] as const)).then((l) => new Map(l)),
  ]);
  const finals = finalsBetween(allFinals, first, second, lineage);
  const total = seriesRecord(first, games.map((g) => g.result));
  const label = (season: number, r: (typeof games)[number]["result"]) => labels.get(season)?.get(gameKey(r.date, r.home, r.away));
  const playoffs = games.filter(({ season, result }) => label(season, result)).length;
  // Newest first. `games` is oldest first and is shared: copy before reversing.
  const meetings = [...games].reverse();
  const title = `${a.school} vs ${b.school}`;
  const matchup = `/matchup?a=${first}&b=${second}`;

  const Team = ({ school, slug, group }: { school: string; slug: string; group: string }) => (
    <Link href={`/programs/${slug}`} className="flex min-h-11 flex-col items-start gap-1.5 text-navy hover:underline">
      <Crest school={school} identity={identities.get(slug) ?? EMPTY} size={56} decorative />
      <span className="font-num text-[24px] font-bold uppercase leading-[1.05] tracking-wide [overflow-wrap:anywhere]">{school}</span>
      <span className="text-[12px] font-bold uppercase leading-4 tracking-widest text-muted no-underline">{group}</span>
    </Link>
  );

  return (
    <EdgeToEdge>
    <article aria-labelledby="series" className="mx-auto max-w-3xl border-line bg-white pb-6 sm:border-x">
      <Breadcrumbs trail={[{ name: "Home", href: "/" }, { name: "Programs", href: "/programs" }, { name: title, href: `/series/${first}/${second}` }]} />
      <header className="px-3 pt-5">
        <p className="text-[12px] font-bold uppercase tracking-widest text-red">Series since {since}</p>
        <h1 id="series" className="mt-0.5 font-num text-[36px] font-bold uppercase leading-[1.02] tracking-wide text-navy [overflow-wrap:anywhere] sm:text-[44px]">
          {title}
        </h1>
        <div className="mt-4 grid grid-cols-2 gap-x-4">
          <Team school={a.school} slug={first} group={heading(a)} />
          <Team school={b.school} slug={second} group={heading(b)} />
        </div>
        <p className="mt-4 text-[17px] leading-6 text-ink">
          <b className="font-num text-[24px] tabular-nums">{record(total)}</b> for {a.school} against {b.school} since {since}
          <span className="text-muted">{` · ${games.length} meetings${playoffs > 0 ? `, ${playoffs} in the playoffs` : ""}`}</span>
        </p>
        <p className="pt-1 text-[13px] text-muted">A forfeit counts as a win or a loss.</p>
      </header>

      <section aria-labelledby="meetings" className="mt-4">
        <SectionBar id="meetings" title="Every meeting" aside="Newest first" className="mt-2" />
        <ul>
          {meetings.map(({ season, result: r }) => {
            const round = label(season, r);
            return (
              <li key={r.id} className="border-b border-line">
                <Link
                  href={r.href}
                  aria-label={`${mediumDate(r.date)}, ${r.away} vs ${r.home}${r.forfeit ? ", forfeit" : `, ${r.awayScore}-${r.homeScore}`}, game page`}
                  className="grid min-h-14 grid-cols-[6.75rem_1fr_auto_auto] items-center gap-x-3 px-3 py-1 hover:bg-panel"
                >
                  <span className="font-num text-[14px] font-bold uppercase leading-tight text-navy">{mediumDate(r.date)}</span>
                  <span className="min-w-0 text-[15px] leading-5 text-ink">
                    {r.away} vs {r.home}
                    <span className="block text-[13px] leading-4 text-muted">{round ? `${season} playoffs · ${round}` : `${season} season`}</span>
                  </span>
                  <span className="font-num text-[19px] font-bold tabular-nums text-ink">{r.forfeit ? "Forfeit" : `${r.awayScore}-${r.homeScore}`}</span>
                  <ChevronRight aria-hidden="true" className="size-4 text-muted" />
                </Link>
              </li>
            );
          })}
        </ul>
        <p className="px-3 pt-1 text-[13px] text-muted">Away team first. Playoff games name their round.</p>
      </section>

      {finals.length > 0 && (
        <section aria-labelledby="finals" className="mt-6">
          <SectionBar id="finals" title="State Championships" className="mt-2" />
          <ul>
            {finals.map((f) => (
              <li key={`${f.season}-${f.division}`} className="grid min-h-12 grid-cols-[3.5rem_1fr_auto] items-center gap-x-3 border-b border-line px-3 py-1.5">
                <span className="font-num text-[18px] font-bold text-navy">{f.season}</span>
                <span className="min-w-0 text-[15px] leading-5 text-ink">
                  <b>Champion</b> {f.champion}
                  {f.division && <span className="whitespace-nowrap text-muted"> · Div {f.division}</span>}
                  <span className="block text-[14px] text-muted">Runner-up {f.runnerUp}</span>
                </span>
                <span className="max-w-[8.5rem] text-right font-num text-[19px] font-bold tabular-nums text-ink">{finalScore(f)}</span>
              </li>
            ))}
          </ul>
          <p className="px-3 pt-1 text-[13px] text-muted">UIL State Championships the two programs played each other in, merged schools included.</p>
        </section>
      )}

      {projection && (
        <section aria-labelledby="projection" className="mt-6">
          <SectionBar id="projection" title="If they met now" className="mt-2" />
          <p className="px-3 pt-2 text-[18px] font-semibold leading-6 text-ink">
            Projected margin: {projectionParts(projection).margin} <span className="text-muted">·</span> {projectionParts(projection).chance}
          </p>
          <p className="px-3 pt-1 text-[13px] leading-4 text-muted">From today&rsquo;s ratings, on a neutral field. A projection, not a result.</p>
          <Link href={matchup} prefetch={false} className="mx-3 mt-1 flex min-h-11 items-center gap-1 text-[15px] font-semibold text-navy underline underline-offset-2">
            Compare {a.school} and {b.school} in Matchup
            <ChevronRight aria-hidden="true" className="size-4" strokeWidth={2.5} />
          </Link>
        </section>
      )}
    </article>
    </EdgeToEdge>
  );
}
