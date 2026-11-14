import { ChevronRight, Trophy } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { KickoffStatus } from "../../kickoff-status";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { heading, loadAlignments, placeLabel, programFor, slugify, uniquePrograms } from "@/lib/alignments";
import { finalScore, loadFinals } from "@/lib/champions";
import { programDescription, rankPhrase } from "@/lib/descriptions";
import { titlesBySlug } from "@/lib/program-titles";
import { loadCorrections } from "@/lib/correction-files";
import { loadAliases, loadLineage, otherNames } from "@/lib/lineage";
import { activeOrgs } from "@/lib/active-orgs";
import { orgByLeague } from "@/lib/orgs";
import { loadRanked, rankLabel } from "@/lib/rankings";
import { ratedFromOutsideOnly, OUTSIDE_ONLY_NOTE } from "@/lib/outside-only";
import { FEW_GAMES, loadRatings, ratingSeasons, record, signed } from "@/lib/ratings";
import { meetingScore, schedulesFor, type Meeting } from "@/lib/schedule-strength";
import { whyItMoved } from "@/lib/why-moved";
import { seasonHref } from "../../rankings/view";
import { CURRENT_SEASON } from "@/lib/season";
import { tonightsDate } from "@/lib/tonight";
import { loadStandings, ordinal, standingsHref, wl } from "@/lib/standings";
import { loadGames, loadSeasonResults, roundPhrase } from "@/lib/games";
import { playedCounts } from "@/lib/season-results";
import { lead, seasonRows, type Row } from "@/lib/program-games";
import { ProgramLiveRead, ProgramLiveScore } from "../../scores/live-game";
import { embedSnippet } from "@/lib/embed-html";
import { ratingSeries, type Rivalry } from "@/lib/program-history";
import { programHistory, programSeasonPages } from "@/lib/program-seasons";
import { seriesHref } from "@/lib/series";
import { seriesPartners } from "@/lib/series-data";
import { contrast, EMPTY, loadIdentities } from "@/lib/identity";
import { Crest, HEADER_CREST_MAX_ASPECT, headerCrestSize } from "../crest";
import { PathToFinal } from "../path-to-final";
import { Follow } from "../follow";
import { Breadcrumbs } from "../../breadcrumbs";
import { JsonLd } from "../../json-ld";
import { programJsonLd } from "@/lib/json-ld";
import { ShareButton } from "../../share-button";
import { SITE_NAME } from "@/lib/site";
import { RatingChart, ratingPoints } from "../rating-chart";
import { SeasonRatings } from "../season-ratings";
import { RankTrend, rankTrend } from "../trend";
import { CrestSlot, EdgeToEdge } from "../../ui";

type Props = { params: Promise<{ slug: string }> };

export const dynamicParams = false;
export const generateStaticParams = async () => uniquePrograms(await loadAlignments()).map((a) => ({ slug: a.slug }));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const school = (await loadAlignments()).find((a) => a.slug === slug);
  // The same record and rank the page's header shows (the latest season's table), and the same title count.
  const [ranked, seasons, titles] = await Promise.all([loadRanked(), ratingSeasons(), titlesBySlug()]);
  const team = ranked.teams.find((t) => t.school.slug === slug);
  return {
    title: `${school?.school ?? "Program"}`,
    ...(school && {
      description: programDescription({
        name: school.school,
        group: heading(school),
        place: placeLabel(school) === "Teams" ? "" : placeLabel(school),
        season: seasons[0],
        since: seasons.at(-1)!,
        titles: titles.get(slug) ?? 0,
        team: team && { record: record(team), rank: rankPhrase(rankLabel(team).text) },
      }),
    }),
    alternates: { canonical: `/programs/${slug}` },
  };
}

const NAVY = "#0a2a5e";

/** A section: the site's navy heading band, with a stripe in one of the school's own colors down its left edge. */
function Section({ id, title, accent, children, className = "mt-7" }: { id: string; title: string; accent: string; children: ReactNode; className?: string }) {
  return (
    <section aria-labelledby={id} className={className}>
      <h2
        id={id}
        className="bg-navy py-1 pl-5 pr-3 font-num text-[20px] font-bold uppercase tracking-wider text-white"
        style={{ boxShadow: `inset 8px 0 0 ${accent}` }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

/** A dash for a figure the data does not have, with words for a screen reader. */
function Dash({ what }: { what: string }) {
  return (
    <>
      <span aria-hidden="true">&mdash;</span>
      <span className="sr-only">no {what}</span>
    </>
  );
}

/** A figure in the team header: a small label over a big number, in the school's own foreground color (already 4.5:1 on its band). */
function Stat({ label, children, sub }: { label: string; children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="border-t border-current/30 pt-2 sm:border-l sm:border-t-0 sm:pl-3 sm:first:border-l-0 sm:first:pl-0">
      <dt className="text-[13px] font-bold uppercase tracking-widest">{label}</dt>
      <dd className="font-num text-[26px] font-bold leading-tight tabular-nums">{children}</dd>
      {sub && <dd className="pb-1 text-[13px] font-semibold leading-4">{sub}</dd>}
    </div>
  );
}

export default async function ProgramPage({ params }: Props) {
  const { slug } = await params;
  const all = await loadAlignments();
  const school = all.find((a) => a.slug === slug);
  if (!school) notFound();
  const identities = await loadIdentities();
  const identity = identities.get(slug) ?? EMPTY;
  const ranked = (await loadRanked()).teams.find((t) => t.school.slug === slug);
  const org = orgByLeague(school.league);
  // A season links to its rankings only where the organization has rankings pages (lib/active-orgs.ts): Independent
  // gets none until a game against a listed school is read, though CenTex is rated from its outside games.
  const ranksPage = !org || (await activeOrgs()).includes(org);
  const sameOrg = new Set(all.filter((a) => a.league === school.league).map((a) => a.slug));
  const standing = (await loadStandings(CURRENT_SEASON)).find((d) => d.rows.some((r) => r.school.slug === slug));
  const place = standing ? standing.rows.findIndex((r) => r.school.slug === slug) + 1 : 0;
  const opponentLink = (name: string) => {
    const opponent = programFor(all, name, school.league);
    return opponent ? (
      <Link href={`/programs/${opponent.slug}`} className="name-link relative z-10">
        {name}
      </Link>
    ) : (
      name
    );
  };
  /** The opponent's crest in the same-width slot, or an empty slot of that width for a team that is not a program here
   * (no invented badge), so names line up down a list. */
  const opponentCrest = (name: string) => {
    const opponent = programFor(all, name, school.league);
    return opponent ? <CrestSlot school={opponent.school} identity={identities.get(opponent.slug) ?? EMPTY} /> : <span aria-hidden="true" className="mr-2 w-10 shrink-0" />;
  };
  const { theme } = identity;
  // The school's own colors carry the page without hurting contrast: the heading stripe is whichever of its colors shows
  // up on navy, and the rank line uses the school's main color only where it stands out on white.
  const accent = [theme.stripe, theme.bg, theme.fg].find((c): c is string => !!c && contrast(c, NAVY) >= 3) ?? "#ffffff";
  const lineColor = contrast(theme.bg, "#ffffff") >= 3 ? theme.bg : NAVY;
  const mates = all.filter(
    (a) => a.slug !== slug && a.league === school.league && a.division === school.division && a.region === school.region && a.district === school.district,
  );
  // The season as one timeline: robot-read results and playoff games together, by date (lib/program-games.ts).
  const { rows, results, games, latest, next } = seasonRows(school.school, await loadGames(all), await loadSeasonResults(CURRENT_SEASON));
  // This program's own finals, and those of the schools that merged into it (ADR 0003), marked "as <old name>".
  const lineage = await loadLineage();
  const names = new Set([slug, ...lineage.filter((l) => slugify(l.successor) === slug).map((l) => slugify(l.predecessor))]);
  const aka = otherNames(slug, lineage, await loadAliases(), (await loadCorrections()).merges);
  const finals = (await loadFinals())
    .filter((f) => names.has(slugify(f.champion)) || names.has(slugify(f.runnerUp)))
    .sort((a, b) => b.season - a.season);
  const titles = finals.filter((f) => names.has(slugify(f.champion))).length;
  // Season by season, FIRST_SEASON on: record, final rating, place within its organization and the last playoff round played, from each
  // season's table (lib/program-seasons.ts); a season with nothing on record keeps its row, with dashes.
  const seasons = await ratingSeasons();
  const { entries, opponents } = await programHistory(school, seasons);
  // The seasons with a page of their own (lib/program-seasons.ts): each season's row links to it.
  const seasonPages = new Set((await programSeasonPages()).get(slug));
  // The opponents this program has a series page with (lib/series-data.ts): their games count links to it.
  const partners = (await seriesPartners()).get(slug);
  const current = await loadRatings(seasons[0]);
  // What the rating rests on: the games played (from the season's games the site lists) and the ratings' own `rated`.
  const played = ranked ? (playedCounts(await loadSeasonResults(seasons[0])).get(ranked.team) ?? 0) : 0;
  // How hard the record was, measured against this organization's top teams (lib/schedule-strength.ts), and the game each
  // week that went furthest from its projection (lib/why-moved.ts).
  const schedule = ranked ? (await schedulesFor(seasons[0], ranked.org.league)).stats.get(ranked.team) : undefined;
  const moves = ranked ? await whyItMoved(seasons[0], ranked.team) : [];
  const trend = ranked ? rankTrend(current, ranked.team, sameOrg) : [];
  const ratings = ranked ? ratingPoints(current, ranked.team) : [];
  const withRecord = entries.filter((e) => e.line.record);
  const sum = (k: "won" | "lost" | "tied") => withRecord.reduce((n, e) => n + e.line.record![k], 0);
  const allTime = { won: sum("won"), lost: sum("lost"), tied: sum("tied"), playoffs: entries.filter((e) => e.line.playoff).length };
  // Rivalries: the opponents met most often across every season read, with this school's record against each; every other opponent is under "All opponents".
  const rivals = opponents.filter((o) => o.games >= 3).slice(0, 6);
  const ratingLine = ratingSeries(entries.map((e) => e.line));
  const group = school.district === "0" ? "Division" : /^\d+$/.test(school.district) ? "District" : school.district;

  /** A game row: date, opponent (and a projection or round), score. Every game links to its page: the score is the link,
   * stretched over the row, and the opponent's name stays its own link above it. */
  const GameRow = ({ r, big = true }: { r: Row; big?: boolean }) => {
    const score = (
      <span className={`font-num font-bold tabular-nums text-ink ${big ? "text-[22px]" : "text-[19px]"}`}>
        {r.score ??
          // The next game, while under way, shows its live score here (ADR 0021); every other unplayed game, the arrow.
          (r.id === next?.id && r.date ? (
            <ProgramLiveScore date={r.date} school={school.school} opponent={r.opponent} home={r.home}>
              <ChevronRight aria-hidden="true" className="size-5 text-muted" />
            </ProgramLiveScore>
          ) : (
            <ChevronRight aria-hidden="true" className="size-5 text-muted" />
          ))}
      </span>
    );
    return (
      <li key={r.id} className="relative border-b border-line hover:bg-panel">
        <div className="grid min-h-14 grid-cols-[4.5rem_1fr_auto] items-center gap-x-3 px-3 py-1">
          <span className="font-num text-[14px] font-bold uppercase leading-tight text-navy">
            {r.status}
            {/* Not yet played: its kickoff status when the page is viewed (ADR 0036). */}
            {!r.score && r.date && <KickoffStatus date={r.date} kickoff={r.kickoff} short className="block w-fit font-sans text-[13px] normal-case" />}
          </span>
          <span className="min-w-0 text-[15px] leading-5 text-ink">
            <span className="flex items-center">
              {opponentCrest(r.opponent)}
              <span className="flex min-w-0 items-center gap-1">
                {lead(r)} {opponentLink(r.opponent)}
              </span>
            </span>
            {r.note && <span className="block text-[13px] leading-4 text-muted">{r.note}</span>}
          </span>
          {r.href ? (
            <Link
              href={r.href}
              aria-label={`${r.status} ${lead(r)} ${r.opponent}${r.score ? `, ${r.score}` : ""}, game page`}
              className="flex min-h-11 min-w-11 items-center justify-end after:absolute after:inset-0"
            >
              {score}
            </Link>
          ) : (
            score
          )}
        </div>
      </li>
    );
  };

  /** "7 games", a link to the pair's series page when it has one (three or more games, lib/series.ts). Not prefetched: a reader
   * scanning the list may open none of them. `lean`: the "All opponents" list styles its links once, on the list, and names
   * each by its row, so a link there is only its address (about 40 rows a page). */
  const gamesLink = (r: Rivalry, lean = false) => {
    const text = `${r.games} ${r.games === 1 ? "game" : "games"}`;
    if (!partners?.has(slugify(r.opponent))) return text;
    const href = seriesHref(slug, slugify(r.opponent));
    return lean ? (
      <Link href={href} prefetch={false}>
        {text}
      </Link>
    ) : (
      <Link
        href={href}
        prefetch={false}
        aria-label={`${text}, series with ${r.opponent}`}
        className="inline-flex min-h-11 items-center font-semibold text-navy underline underline-offset-2 hover:text-ink"
      >
        {text}
      </Link>
    );
  };

  /** One of the most played: name, games and the latest meeting, and this school's record against it, with the crest slot the game rows have. */
  const OpponentRow = ({ r }: { r: Rivalry }) => (
    <li className="flex min-h-14 items-center gap-3 border-b border-line px-3">
      <span className="min-w-0 flex-1 text-[15px] text-ink">
        <span className="flex items-center">
          {opponentCrest(r.opponent)}
          {opponentLink(r.opponent)}
        </span>
        <span className="flex min-h-11 items-center gap-1 pl-12 text-[13px] text-muted">
          {gamesLink(r)}
          {` · last ${r.last.date.slice(0, 4)}, ${r.last.forfeit ? "forfeit" : `${r.last.us}-${r.last.them}`}`}
        </span>
      </span>
      <span className="font-num text-[22px] font-bold tabular-nums text-ink">{record(r)}</span>
    </li>
  );

  const page = (
    <EdgeToEdge>
      {/* data-pagefind-body: this page is in the site search (app/search). */}
      <article data-pagefind-body aria-labelledby="school" className="mx-auto max-w-3xl border-line bg-white pb-6 sm:border-x">
        <Breadcrumbs trail={[{ name: "Home", href: "/" }, { name: "Programs", href: "/programs" }, { name: school.school, href: `/programs/${slug}` }]} />
        <JsonLd data={programJsonLd({ name: school.school, slug, league: school.league === "Independent" ? undefined : school.league, logo: identity.logo && identity.logo.aspect <= HEADER_CREST_MAX_ASPECT ? identity.logo.src : undefined })} />
        <header className="px-3 pb-3 pt-5" style={{ background: theme.bg, color: theme.fg, borderBottom: `6px solid ${theme.stripe ?? theme.bg}` }}>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
            <Crest school={school.school} identity={identity} size={headerCrestSize(identity)} maxAspect={HEADER_CREST_MAX_ASPECT} />
            <div className="min-w-0">
              <p className="text-[12px] font-bold uppercase tracking-widest">
                {[...new Set([heading(school), placeLabel(school)])].join(" · ")}
              </p>
              <h1 id="school" className="mt-1 font-num text-[40px] font-bold uppercase leading-[0.95] tracking-wide">
                {school.school}
              </h1>
              {identity.mascot && <p className="mt-1 font-num text-[20px] font-semibold uppercase tracking-wider">{identity.mascot}</p>}
            </div>
          </div>
          {ranked ? (
            <>
              <dl className="mt-4 grid grid-cols-2 gap-x-4 sm:flex sm:[&>div]:flex-1">
                <Stat
                  label={`${seasons[0]} record`}
                  sub={
                    ratedFromOutsideOnly(ranked) ? (
                      OUTSIDE_ONLY_NOTE
                    ) : (
                      <>
                        <Link href="/about/ratings" className="inline-flex min-h-11 items-center underline underline-offset-2">
                          {played} played, {ranked.rated} rated
                        </Link>
                        {!!ranked.rated_outside && (
                          <span className="block">
                            + {ranked.rated_outside} rated {ranked.rated_outside === 1 ? "game against a school" : "games against schools"} not listed here
                          </span>
                        )}
                      </>
                    )
                  }
                >
                  {ratedFromOutsideOnly(ranked) ? "–" : record(ranked)}
                </Stat>
                <Stat
                  label="Rank"
                  sub={
                    (rankLabel(ranked).range || rankLabel(ranked).sub) && (
                      <>
                        {rankLabel(ranked).range && <span className="block">Range {rankLabel(ranked).range}</span>}
                        {rankLabel(ranked).sub && <span className="block">{rankLabel(ranked).sub}</span>}
                      </>
                    )
                  }
                >
                  {ranksPage ? (
                    <Link href={rankLabel(ranked).href} className="inline-flex min-h-11 items-center underline underline-offset-2">
                      {rankLabel(ranked).text}
                    </Link>
                  ) : (
                    <span className="inline-flex min-h-11 items-center">{rankLabel(ranked).text}</span>
                  )}
                </Stat>
                <Stat label="Rating" sub={ranked.sd != null && ranked.rated >= FEW_GAMES ? `give or take ${Math.round(ranked.sd)}` : undefined}>
                  {signed(ranked.rating)}
                </Stat>
                {standing && (
                  <Stat label="District" sub={`${wl(standing.rows[place - 1].district)} in district`}>
                    <Link href={standingsHref(standing)} className="inline-flex min-h-11 items-center underline underline-offset-2">
                      {ordinal(place)} of {standing.rows.length}
                    </Link>
                  </Stat>
                )}
              </dl>
              <Link
                href={`/matchup?a=${slug}`}
                prefetch={false} // /matchup is force-static: prefetching it sends about 92 KB the reader may never open
                className="mt-1 flex min-h-11 items-center gap-1 border-t border-current/30 text-[15px] font-semibold underline underline-offset-2"
              >
                Compare with another team
                <ChevronRight aria-hidden="true" className="size-4" strokeWidth={2.5} />
              </Link>
            </>
          ) : (
            <p className="mt-4 border-t border-current/30 pt-3 text-[15px] font-semibold">Not rated yet: a rating appears once this team has a game on record.</p>
          )}
        </header>

        {(next || latest) && (
          <section aria-label="Next and latest game" className="grid gap-px border-b border-line bg-line sm:grid-cols-2">
            {next && (
              <div className="bg-white px-3 py-2.5">
                {/* A game dated before tonight with no score yet is waiting on its score, not still to play. */}
                <p className="text-[12px] font-bold uppercase tracking-widest text-red">{next.date < tonightsDate() ? "Score not in yet" : "Next game"}</p>
                {next.href ? (
                  <Link href={next.href} className="flex min-h-11 items-center justify-between gap-2 text-[16px] font-semibold text-ink hover:text-navy">
                    <span>
                      {next.status} · {lead(next)} {next.opponent}
                      {next.date && (
                        <span className="block text-[14px]">
                          <KickoffStatus date={next.date} kickoff={next.kickoff} />
                        </span>
                      )}
                      {next.date && <ProgramLiveScore line date={next.date} school={school.school} opponent={next.opponent} home={next.home} />}
                      {next.note && <span className="block text-[14px] font-normal text-muted">{next.note}</span>}
                    </span>
                    <ChevronRight aria-hidden="true" className="size-5 shrink-0 text-muted" />
                  </Link>
                ) : (
                  <p className="text-[16px] font-semibold text-ink">
                    {next.status} · {lead(next)} {next.opponent}
                  </p>
                )}
              </div>
            )}
            {latest && (
              <div className="bg-white px-3 py-2.5">
                <p className="text-[12px] font-bold uppercase tracking-widest text-red">Latest score</p>
                <div className="flex min-h-11 items-center justify-between gap-2 text-[16px] font-semibold text-ink">
                  <span>
                    {latest.status} · {lead(latest)} {opponentLink(latest.opponent)}
                  </span>
                  <Link
                    href={latest.href}
                    aria-label={`${latest.score}, game page`}
                    className="inline-flex min-h-11 shrink-0 items-center whitespace-nowrap font-num text-[26px] font-bold tabular-nums hover:text-navy"
                  >
                    {latest.score}
                  </Link>
                </div>
              </div>
            )}
          </section>
        )}

        <Follow slug={slug} school={school.school} />
        <ShareButton title={`${school.school} | ${SITE_NAME}`} className="mt-4 px-3" />

        {/* A team in this season's playoff bracket: its path, round by round, before the full schedule. */}
        <PathToFinal school={school.school} accent={accent} />

        {/* This season's games lead, right after the next and latest game: a fan mid-season wants the schedule before six seasons of history. */}
        <Section id="games" title={`${CURRENT_SEASON} games`} accent={accent} className="mt-4">
          {rows.length ? (
            <>
              <ul>
                {rows.map((r) => (
                  <GameRow key={r.id} r={r} />
                ))}
              </ul>
            </>
          ) : (
            <p className="px-3 py-4 text-[15px] text-muted">No {CURRENT_SEASON} games on record yet. Scores and projections appear here as games are read.</p>
          )}
        </Section>

        {schedule && ranked && (
          <Section id="schedule" title="Record and schedule" accent={accent} className="mt-4">
            <dl className="grid grid-cols-2 gap-x-4 px-3 pt-3">
              <div>
                <dt className="text-[13px] font-bold uppercase tracking-widest text-muted">Record strength</dt>
                <dd className="font-num text-[26px] font-bold leading-tight tabular-nums text-navy">{signed(schedule.sor)}</dd>
              </div>
              <div>
                <dt className="text-[13px] font-bold uppercase tracking-widest text-muted">Opponents&rsquo; rating</dt>
                <dd className="font-num text-[26px] font-bold leading-tight tabular-nums text-navy">{signed(schedule.sos)}</dd>
              </div>
            </dl>
            <p className="px-3 pt-1 text-[14px] text-ink">
              {schedule.wins} {schedule.wins === 1 ? "win" : "wins"} in {schedule.games} {schedule.games === 1 ? "game" : "games"}. A typical top-25 {ranked.org.label} team
              would be expected to win {schedule.expected.toFixed(1)} of them against the same opponents at the same sites, so record strength is the
              difference. The opponents&rsquo; rating is the average of the teams played.
            </p>
            <ul className="mt-2 border-t border-line">
              {(
                [
                  ["Best win", schedule.best],
                  ["Worst loss", schedule.worst],
                ] as [string, Meeting | undefined][]
              ).map(([label, m]) => (
                <li key={label} className="grid min-h-14 grid-cols-[4.5rem_1fr_auto] items-center gap-x-3 border-b border-line px-3 py-1">
                  <span className="font-num text-[14px] font-bold uppercase leading-tight text-navy">{label}</span>
                  {m ? (
                    <>
                      <span className="flex min-w-0 items-center text-[15px] leading-5 text-ink">
                        {opponentCrest(m.opponent)}
                        {opponentLink(m.opponent)}
                      </span>
                      <span className="font-num text-[19px] font-bold tabular-nums text-ink">{meetingScore(m)}</span>
                    </>
                  ) : (
                    <span className="col-span-2 text-[15px] text-muted">None</span>
                  )}
                </li>
              ))}
            </ul>
            <p className="px-3 pt-2 text-[13px] text-muted">Forfeits are left out of the figures.</p>
          </Section>
        )}

        <section aria-labelledby="facts" className="px-3 py-1">
          <h2 id="facts" className="sr-only">Alignment</h2>
          <p className="flex min-h-11 flex-wrap items-center gap-x-4 gap-y-1 text-[14px] text-ink">
            <span>
              <b className="text-[13px] uppercase tracking-wider text-muted">Aligned</b> {school.span}
            </span>
            {identity.colors.map((c) => (
              <span key={c.name} className="inline-flex items-center gap-1.5 capitalize">
                <span aria-hidden="true" className="size-4 border border-line" style={{ background: c.hex }} />
                {c.name}
              </span>
            ))}
          </p>
        </section>

        {trend.length >= 3 && (
          <Section id="trend" title={`${seasons[0]} rank by week`} accent={accent} className="mt-4">
            <RankTrend points={trend} color={lineColor} />
          </Section>
        )}

        {ratings.length >= 3 && (
          <Section id="rating-by-week" title={`${seasons[0]} rating by week`} accent={accent}>
            <RatingChart points={ratings} />
          </Section>
        )}

        {moves.length > 0 && (
          <Section id="why-moved" title="Why the rating moved" accent={accent}>
            <p className="px-3 pt-2 text-[13px] text-muted">
              Each week, the game that went furthest from what the ratings projected the week before.
            </p>
            <ul>
              {moves.map((m) => (
                <li key={m.id} className="relative border-b border-line px-3 py-2 hover:bg-panel">
                  <Link
                    href={m.href}
                    aria-label={`${m.status} ${m.lead} ${m.opponent}, ${m.score}, game page`}
                    className="flex min-h-11 items-center font-num text-[14px] font-bold uppercase leading-tight text-navy after:absolute after:inset-0"
                  >
                    {m.status}
                  </Link>
                  <span className="flex items-center text-[15px] leading-5 text-ink">
                    {opponentCrest(m.opponent)}
                    <span className="min-w-0">
                      {m.lead} {opponentLink(m.opponent)}, {m.score}, {m.projected}
                    </span>
                  </span>
                  <span className="block pl-12 text-[13px] text-muted">
                    {Math.round(Math.abs(m.surprise))} points {m.surprise > 0 ? "better" : "worse"} than projected
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        <Section id="seasons" title="Season by season" accent={accent}>
          {withRecord.length > 1 && (
            <p className="px-3 pt-2 text-[15px] text-ink">
              <b className="font-num text-[19px] tabular-nums">{record(allTime)}</b> from {withRecord.at(-1)!.line.season} to {withRecord[0].line.season}
              {allTime.playoffs > 0 && ` · playoffs in ${allTime.playoffs} of ${withRecord.length} seasons`}
            </p>
          )}
          {ratingLine.filter((p) => p.rating != null).length >= 2 && <SeasonRatings points={ratingLine} />}
          <ul className="mt-1">
            {entries.map(({ line, played }) => (
              <li key={line.season} className="border-b border-line">
                <div className="grid min-h-14 grid-cols-[3.5rem_1fr_auto] items-center gap-x-3 px-3 py-1">
                  {ranksPage ? (
                    <Link
                      href={seasonHref(line.season, seasons[0], org)}
                      aria-label={`${line.season} rankings`}
                      className="inline-flex min-h-11 items-center font-num text-[18px] font-bold text-navy underline"
                    >
                      {line.season}
                    </Link>
                  ) : (
                    <span className="inline-flex min-h-11 items-center font-num text-[18px] font-bold text-navy">{line.season}</span>
                  )}
                  <span className="min-w-0 text-[15px] leading-5 text-ink">
                    {line.outsideOnly ? (
                      <span className="text-[14px] text-muted">{OUTSIDE_ONLY_NOTE}</span>
                    ) : line.record ? (
                      <b className="font-num text-[20px] tabular-nums">{record(line.record)}</b>
                    ) : (
                      <Dash what="record" />
                    )}
                    <span className="text-muted">
                      {" "}
                      {line.rank != null
                        ? `· #${line.rank} of ${line.of} in ${org?.label ?? school.league}`
                        : line.rating != null
                          ? `· Not ranked: fewer than ${FEW_GAMES} games`
                          : line.record
                            ? "· No rating"
                            : "No games on record"}
                    </span>
                    {line.playoff && (
                      <span className="block text-[14px] font-semibold text-navy">Playoffs: reached {roundPhrase(line.playoff.round, line.playoff.league)}</span>
                    )}
                    {seasonPages.has(line.season) && (
                      <Link
                        href={`/programs/${slug}/${line.season}`}
                        prefetch={false}
                        className="flex min-h-11 items-center text-[14px] font-semibold text-navy underline underline-offset-2"
                      >
                        {line.season} season page
                      </Link>
                    )}
                  </span>
                  <span className="text-right">
                    <span className="font-num text-[19px] font-bold tabular-nums text-ink">{line.rating != null ? signed(line.rating) : <Dash what="rating" />}</span>
                    <span className="block text-[13px] font-bold uppercase leading-3 tracking-wider text-muted">rating</span>
                  </span>
                </div>
                {played.length > 0 && (
                  <details className="px-3 pb-2">
                    <summary className="flex min-h-11 cursor-pointer items-center text-[14px] font-semibold text-navy">
                      {line.season} games ({played.length})
                    </summary>
                    <ul className="border-t border-line">
                      {played.map((r) => (
                        <GameRow key={r.id} r={r} big={false} />
                      ))}
                    </ul>
                    <p className="pt-1 text-[13px] text-muted">Playoff games name their round.</p>
                  </details>
                )}
              </li>
            ))}
          </ul>
          <p className="px-3 pt-2 text-[13px] text-muted">
            Final rating and place of each season, among {org?.label ?? school.league} teams as today&rsquo;s alignments place them. A dash means the data has nothing for that season.
          </p>
        </Section>

        {opponents.length > 0 && (
          <Section id="rivals" title={rivals.length ? "Most played" : "Opponents"} accent={accent}>
            <p className="px-3 pt-2 text-[13px] text-muted">
              Record against each since {withRecord.at(-1)?.line.season ?? seasons.at(-1)}. A forfeit counts as a win or a loss.
            </p>
            {rivals.length > 0 && (
              <ul>
                {rivals.map((r) => (
                  <OpponentRow key={r.opponent} r={r} />
                ))}
              </ul>
            )}
            {opponents.length > rivals.length && (
              <details className="px-3 pb-1">
                <summary className="flex min-h-11 cursor-pointer items-center text-[14px] font-semibold text-navy">All opponents ({opponents.length})</summary>
                {/* Every opponent in the leanest markup (about 40 rows a page): the row's look is set once, here, on the list. */}
                <ul className="-mx-3 border-t border-line [&>li]:flex [&>li]:min-h-11 [&>li]:items-center [&>li]:gap-3 [&>li]:border-b [&>li]:border-line [&>li]:px-3 [&_a]:inline-flex [&_a]:min-h-11 [&_a]:items-center [&_a:hover]:text-navy [&_a:hover]:underline [&>li>span]:flex [&>li>span]:min-w-0 [&>li>span]:flex-1 [&>li>span]:items-center [&>li>span]:text-[15px] [&>li>span]:text-ink [&>li>small]:text-[13px] [&>li>small]:text-muted [&>li>small_a]:font-semibold [&>li>small_a]:text-navy [&>li>small_a]:underline [&>li>b]:font-num [&>li>b]:text-[19px] [&>li>b]:tabular-nums [&>li>b]:text-ink">
                  {opponents.map((r) => (
                    <li key={r.opponent}>
                      <span>{opponentCrest(r.opponent)}{opponentLink(r.opponent)}</span>
                      <small>{gamesLink(r, true)}{` · last ${r.last.date.slice(0, 4)}`}</small>
                      <b>{record(r)}</b>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </Section>
        )}

        {finals.length > 0 && (
          <Section id="finals" title="State championships" accent={accent}>
            <p className="px-3 pt-2 font-num text-[20px] font-bold text-ink">
              {titles === 0 ? "No UIL state titles" : titles === 1 ? "1 UIL state title" : `${titles} UIL state titles`}
              {finals.length > titles && `, ${finals.length - titles} runner-up ${finals.length - titles === 1 ? "finish" : "finishes"}`}
            </p>
            <ul className="mt-1">
              {finals.map((f) => {
                const won = names.has(slugify(f.champion));
                const as = won ? f.champion : f.runnerUp;
                return (
                  <li key={`${f.season}-${f.division}`} className="grid min-h-12 grid-cols-[3.5rem_1fr_auto] items-center gap-x-3 border-b border-line px-3 py-1.5">
                    <span className="font-num text-[18px] font-bold text-navy">{f.season}</span>
                    <span className="min-w-0 text-[15px] leading-5 text-ink">
                      {won && <Trophy aria-hidden="true" className="mr-1 inline size-4 align-[-2px] text-red" />}
                      <b className={won ? "text-red" : "text-muted"}>{won ? "Champion" : "Runner-up"}</b>
                      {f.division && <span className="whitespace-nowrap text-muted"> · Div {f.division}</span>}
                      {slugify(as) !== slug && <span className="text-muted"> · as {as}</span>}
                      <span className="block text-[14px] text-muted">
                        {won ? "over" : "to"} {won ? f.runnerUp : f.champion}
                      </span>
                    </span>
                    <span className="max-w-[8.5rem] text-right font-num tabular-nums text-ink">
                      {f.championScore == null ? (
                        <span className="text-[16px]">{finalScore(f)}</span>
                      ) : (
                        <>
                          <span className="block text-[19px] font-bold leading-5">{`${f.championScore}-${f.runnerUpScore}`}</span>
                          {f.scoreNote && <span className="block text-[13px] leading-4 text-muted">{f.scoreNote}</span>}
                        </>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </Section>
        )}

        {aka.length > 0 && (
          <Section id="other-names" title="Other names" accent={accent}>
            <ul>
              {aka.map((n) => (
                <li key={n.name} className="flex min-h-11 flex-wrap items-baseline gap-x-2 border-b border-line px-3 py-2 text-[15px] text-ink">
                  <b>{n.name}</b>
                  <span className="text-[14px] text-muted">{n.note}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {mates.length > 0 && (
          <Section id="mates" title={`${group === "District" ? `District ${school.district}` : group} rivals`} accent={accent}>
            <ul className="sm:grid sm:grid-cols-2">
              {mates.map((m) => (
                <li key={m.slug} className="border-b border-line">
                  <Link href={`/programs/${m.slug}`} className="flex min-h-11 items-center gap-2.5 px-3 text-[15px] text-ink hover:bg-panel hover:text-navy">
                    <Crest school={m.school} identity={identities.get(m.slug) ?? EMPTY} size={28} decorative />
                    {m.school}
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* The embeddable scoreboard (ADR 0023): the iframe is text to copy, never an element on this page. */}
        <details data-pagefind-ignore className="mx-3 mt-6 border-t border-line">
          <summary className="flex min-h-11 cursor-pointer items-center text-[14px] font-semibold text-navy">Put this on your site</summary>
          <p className="text-[14px] text-ink">Copy this into your school or booster page to show {school.school}&rsquo;s record, latest scores and next game.</p>
          <pre className="mt-2 whitespace-pre-wrap break-words border border-line bg-panel p-3 text-[13px] text-ink">
            <code>{embedSnippet(slug, school.school)}</code>
          </pre>
          <p className="pb-2 pt-1 text-[13px] text-muted">
            Colors follow the visitor&rsquo;s device. Add <code>?theme=light</code>, <code>?theme=dark</code> or <code>?theme=auto</code> to the address to choose.
          </p>
        </details>
      </article>
    </EdgeToEdge>
  );
  // One live read for the page's next game, shared by its box and its row, and only while it is in progress (ADR 0021).
  return next?.date ? (
    <ProgramLiveRead date={next.date} kickoff={next.kickoff}>
      {page}
    </ProgramLiveRead>
  ) : (
    page
  );
}
