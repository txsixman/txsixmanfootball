import { ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { heading, loadAlignments, placeLabel, programFor } from "@/lib/alignments";
import { activeOrgs } from "@/lib/active-orgs";
import { programSeasonDescription } from "@/lib/descriptions";
import { bracketGames } from "@/lib/game-pages";
import { loadSeasonResults, roundPhrase } from "@/lib/games";
import { EMPTY, loadIdentities } from "@/lib/identity";
import { orgByLeague } from "@/lib/orgs";
import { pregame } from "@/lib/pregame";
import { seasonRows, type Row } from "@/lib/program-games";
import { programSeason, programSeasonPages } from "@/lib/program-seasons";
import { projectionText } from "@/lib/projection";
import { FEW_GAMES, ratingSeasons, record, signed } from "@/lib/ratings";
import { seriesHref } from "@/lib/series";
import { seriesPartners } from "@/lib/series-data";
import { CURRENT_SEASON } from "@/lib/season";
import { Breadcrumbs } from "../../../breadcrumbs";
import { seasonHref } from "../../../rankings/view";
import { CrestSlot, EdgeToEdge, SectionBar } from "../../../ui";
import { Crest, HEADER_CREST_MAX_ASPECT, headerCrestSize } from "../../crest";

// One program's season, 2021 on (ADR 0013: records, ranks and scores may rest on unconfirmed robot-read results, so the page
// says so and no game row names a winner, ADR 0004). The record, rank and last playoff round are the program page's own
// season row (lib/program-seasons.ts); only a season with a game read has a page, and any other address is a 404. The share
// card is the program's (app/programs/[slug]/opengraph-image.tsx): this route adds no image of its own.
type Props = { params: Promise<{ slug: string; season: string }> };

export const dynamicParams = false;
export const generateStaticParams = async () =>
  [...(await programSeasonPages())].flatMap(([slug, seasons]) => seasons.map((season) => ({ slug, season: String(season) })));

/** The program and season an address names, with the season's line and games; undefined where there is no page. */
async function load({ slug, season: text }: { slug: string; season: string }) {
  const season = Number(text);
  const pages = (await programSeasonPages()).get(slug);
  const school = (await loadAlignments()).find((a) => a.slug === slug);
  if (!school || !pages?.includes(season) || String(season) !== text) return undefined;
  const { entry } = await programSeason(school, season, true);
  return { school, season, pages, line: entry.line, played: entry.played, org: orgByLeague(school.league) };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const found = await load(await params);
  if (!found) return { title: "Season" };
  const { school, season, line, org } = found;
  return {
    title: `${school.school} ${season} season`,
    description: programSeasonDescription({
      name: school.school,
      season,
      games: line.games,
      record: line.record ? record(line.record) : undefined,
      rank: line.rank != null ? { place: line.rank, org: org?.label ?? school.league } : undefined,
      playoff: line.playoff ? roundPhrase(line.playoff.round, line.playoff.league) : undefined,
    }),
    alternates: { canonical: `/programs/${school.slug}/${season}` },
  };
}

export default async function ProgramSeasonPage({ params }: Props) {
  const found = await load(await params);
  if (!found) notFound();
  const { school, season, pages, line, played, org } = found;
  const slug = school.slug;
  const [all, identities, partners, projections, seasons, active] = await Promise.all([
    loadAlignments(),
    loadIdentities(),
    seriesPartners(),
    pregame(season),
    ratingSeasons(),
    activeOrgs(),
  ]);
  const identity = identities.get(slug) ?? EMPTY;
  const { theme } = identity;
  const pagesOf = await programSeasonPages();

  // Every game read, oldest first. For the season under way, a bracket game not yet played joins them, with its projection.
  const unplayed = season === CURRENT_SEASON ? seasonRows(school.school, await bracketGames(), await loadSeasonResults(season)).rows.filter((r) => !r.score) : [];
  const rows: Row[] = [...played, ...unplayed].sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999"));

  const label = org?.label ?? school.league;
  const ranksPage = !org || active.includes(org);
  const place = [...new Set([heading(school), placeLabel(school)])].join(" · ");

  /** The opponent as a link: to its season page when it has one, else its program page, else its name. */
  const opponent = (name: string) => {
    const program = programFor(all, name, school.league);
    if (!program) return { link: name, crest: <span aria-hidden="true" className="mr-2 w-10 shrink-0" />, series: undefined };
    const href = pagesOf.get(program.slug)?.includes(season) ? `/programs/${program.slug}/${season}` : `/programs/${program.slug}`;
    return {
      link: (
        <Link href={href} prefetch={false} className="name-link relative z-10">
          {name}
        </Link>
      ),
      crest: <CrestSlot school={program.school} identity={identities.get(program.slug) ?? EMPTY} />,
      series: partners.get(slug)?.has(program.slug) ? { href: seriesHref(slug, program.slug), name } : undefined,
    };
  };

  const trail = [
    { name: "Home", href: "/" },
    { name: "Programs", href: "/programs" },
    { name: school.school, href: `/programs/${slug}` },
    { name: `${season} season`, href: `/programs/${slug}/${season}` },
  ];

  return (
    <EdgeToEdge>
      <article aria-labelledby="season" className="mx-auto max-w-3xl border-line bg-white pb-6 sm:border-x">
        <Breadcrumbs trail={trail} />
        <header className="px-3 pb-3 pt-5" style={{ background: theme.bg, color: theme.fg, borderBottom: `6px solid ${theme.stripe ?? theme.bg}` }}>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
            <Crest school={school.school} identity={identity} size={headerCrestSize(identity)} maxAspect={HEADER_CREST_MAX_ASPECT} />
            <div className="min-w-0">
              <p className="text-[12px] font-bold uppercase tracking-widest">{place}</p>
              <h1 id="season" className="mt-1 font-num text-[40px] font-bold uppercase leading-[0.95] tracking-wide [overflow-wrap:anywhere]">
                {school.school} {season}
              </h1>
            </div>
          </div>
        </header>

        <section aria-label="Season summary" className="px-3 pt-3">
          <p className="text-[17px] leading-6 text-ink">
            {line.record ? <b className="font-num text-[24px] tabular-nums">{record(line.record)}</b> : "No record"}
            <span className="text-muted">
              {line.rank != null
                ? ` · #${line.rank} of ${line.of} in ${label}`
                : line.rating != null
                  ? ` · Not ranked: fewer than ${FEW_GAMES} games`
                  : line.record
                    ? " · No rating"
                    : ""}
              {line.rating != null && ` · ${season === seasons[0] ? "Rating" : "Final rating"} ${signed(line.rating)}`}
            </span>
          </p>
          {line.playoff && <p className="pt-1 text-[15px] font-semibold text-navy">Playoffs: reached {roundPhrase(line.playoff.round, line.playoff.league)}</p>}
          <p className="pt-1 text-[13px] text-muted">
            Record counts the playoffs; a forfeit counts as a win or a loss. Rank is among {label} teams as today&rsquo;s alignments place them. Season scores, not confirmed here.
          </p>
        </section>

        <section aria-labelledby="games" className="mt-4">
          <SectionBar id="games" title={`${season} games`} aside="Oldest first" className="mt-2" />
          <ul>
            {rows.map((r) => {
              const opp = opponent(r.opponent);
              // A playoff game names its round; a game the ratings had a view on (both teams four games in) adds the projection from the week before.
              const projected = projections.get(r.id);
              const notes = [r.note, projected && `Projected: ${projectionText(projected)}`].filter(Boolean);
              return (
                <li key={r.id} className="relative border-b border-line hover:bg-panel">
                  <div className="grid min-h-14 grid-cols-[4.5rem_1fr_auto] items-center gap-x-3 px-3 py-1">
                    <span className="font-num text-[14px] font-bold uppercase leading-tight text-navy">{r.status}</span>
                    <span className="min-w-0 text-[15px] leading-5 text-ink">
                      <span className="flex items-center">
                        {opp.crest}
                        <span className="flex min-w-0 items-center gap-1">
                          {r.home ? "vs" : "at"} {opp.link}
                        </span>
                      </span>
                      {notes.map((n) => (
                        <span key={n} className="block text-[13px] leading-4 text-muted">
                          {n}
                        </span>
                      ))}
                      {opp.series && (
                        <Link
                          href={opp.series.href}
                          prefetch={false}
                          aria-label={`${school.school} and ${opp.series.name} series`}
                          className="relative z-10 inline-flex min-h-11 items-center text-[14px] font-semibold text-navy underline underline-offset-2"
                        >
                          Series
                        </Link>
                      )}
                    </span>
                    <Link
                      href={r.href}
                      prefetch={false}
                      aria-label={`${r.status} ${r.home ? "vs" : "at"} ${r.opponent}${r.score ? `, ${r.score}` : ""}, game page`}
                      className="flex min-h-11 min-w-11 items-center justify-end after:absolute after:inset-0"
                    >
                      <span className="font-num text-[22px] font-bold tabular-nums text-ink">
                        {r.score ?? <ChevronRight aria-hidden="true" className="size-5 text-muted" />}
                      </span>
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="px-3 pt-2 text-[13px] text-muted">
            {school.school}&rsquo;s score first. Season scores, not confirmed here. Playoff games name their round; a projection is the ratings&rsquo; view the week before.
          </p>
        </section>

        <nav aria-labelledby="other-seasons" className="mt-6">
          <SectionBar id="other-seasons" title={`${school.school} seasons`} className="mt-2" />
          <ul className="flex flex-wrap px-3 pt-1">
            {pages
              .filter((s) => s !== season)
              .map((s) => (
                <li key={s}>
                  <Link href={`/programs/${slug}/${s}`} prefetch={false} className="inline-flex min-h-11 min-w-11 items-center justify-center pr-4 text-[16px] font-semibold text-navy underline underline-offset-2">
                    {s}
                  </Link>
                </li>
              ))}
          </ul>
          <ul className="px-3">
            <li>
              <Link href={`/programs/${slug}`} prefetch={false} className="inline-flex min-h-11 items-center gap-1 text-[15px] font-semibold text-navy underline underline-offset-2">
                {school.school} program page
                <ChevronRight aria-hidden="true" className="size-4" strokeWidth={2.5} />
              </Link>
            </li>
            {ranksPage && (
              <li>
                <Link href={seasonHref(season, seasons[0], org)} prefetch={false} className="inline-flex min-h-11 items-center gap-1 text-[15px] font-semibold text-navy underline underline-offset-2">
                  {season} {label} rankings
                  <ChevronRight aria-hidden="true" className="size-4" strokeWidth={2.5} />
                </Link>
              </li>
            )}
          </ul>
        </nav>
      </article>
    </EdgeToEdge>
  );
}
