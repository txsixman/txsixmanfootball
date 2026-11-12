import { ArrowLeft, ChevronRight, Trophy } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { heading, loadAlignments, placeLabel, programFor, slugify, uniquePrograms } from "@/lib/alignments";
import { finalScore, loadFinals } from "@/lib/champions";
import { loadCorrections } from "@/lib/correction-files";
import { loadAliases, loadLineage, otherNames } from "@/lib/lineage";
import { activeOrgs } from "@/lib/active-orgs";
import { orgByLeague } from "@/lib/orgs";
import { loadRanked, rankLabel } from "@/lib/rankings";
import { FEW_GAMES, loadRatings, ratingSeasons, record, signed } from "@/lib/ratings";
import { meetingScore, schedulesFor, type Meeting } from "@/lib/schedule-strength";
import { whyItMoved } from "@/lib/why-moved";
import { seasonHref } from "../../rankings/view";
import { CURRENT_SEASON } from "@/lib/season";
import { loadStandings, ordinal, standingsHref, wl } from "@/lib/standings";
import { loadGames, loadSeasonResults, playoffReach, roundPhrase } from "@/lib/games";
import { fromResult, seasonRows, type Row } from "@/lib/program-games";
import { contrast, EMPTY, loadIdentities } from "@/lib/identity";
import { Crest } from "../crest";
import { Follow } from "../follow";
import { ShareButton } from "../../share-button";
import { SITE_NAME } from "@/lib/site";
import { RatingChart, ratingPoints } from "../rating-chart";
import { RankTrend, rankTrend } from "../trend";
import { CrestSlot, EdgeToEdge } from "../../ui";

type Props = { params: Promise<{ slug: string }> };

export const dynamicParams = false;
export const generateStaticParams = async () => uniquePrograms(await loadAlignments()).map((a) => ({ slug: a.slug }));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const school = (await loadAlignments()).find((a) => a.slug === slug);
  return { title: `${school?.school ?? "Program"}` };
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
      <Link href={`/programs/${opponent.slug}`} className="relative z-10 inline-flex min-h-11 items-center hover:text-navy hover:underline">
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
  // Season by season: record, rating and place within its organization from each season's table, and the last playoff round played.
  const seasons = await ratingSeasons();
  const history = (
    await Promise.all(
      seasons.map(async (season) => {
        const [table, reach] = await Promise.all([loadRatings(season), playoffReach(season)]);
        // The place is among the teams of this school's own organization (ADR 0012), by the current alignments.
        const mine = table.teams.filter((t) => sameOrg.has(slugify(t.team)));
        const at = mine.findIndex((t) => slugify(t.team) === slug);
        if (at < 0) return undefined;
        const playoff = [...reach].find(([team]) => slugify(team) === slug)?.[1];
        // A past season's games fold under its row; the season under way lists its games below.
        const played =
          season === seasons[0] ? [] : (await loadSeasonResults(season)).filter((r) => r.home === school.school || r.away === school.school).map((r) => fromResult(school.school, r));
        return { season, row: mine[at], place: at + 1, of: mine.length, playoff, played };
      }),
    )
  ).filter((h) => h !== undefined);
  const current = await loadRatings(seasons[0]);
  // How hard the record was, measured against this organization's top teams (lib/schedule-strength.ts), and the game each
  // week that went furthest from its projection (lib/why-moved.ts).
  const schedule = ranked ? (await schedulesFor(seasons[0], ranked.org.league)).stats.get(ranked.team) : undefined;
  const moves = ranked ? await whyItMoved(seasons[0], ranked.team) : [];
  const trend = ranked ? rankTrend(current, ranked.team, sameOrg) : [];
  const ratings = ranked ? ratingPoints(current, ranked.team) : [];
  const sum = (k: "won" | "lost" | "tied") => history.reduce((n, h) => n + h.row[k], 0);
  const allTime = { won: sum("won"), lost: sum("lost"), tied: sum("tied"), playoffs: history.filter((h) => h.playoff).length };
  // Rivalries: the opponents met most often across every season read, with this school's record against each.
  const meetings = (await Promise.all(seasons.map((season) => loadSeasonResults(season))))
    .flat()
    .filter((r) => r.home === school.school || r.away === school.school)
    .map((r) => {
      const home = r.home === school.school;
      const [us, them] = home ? [r.homeScore, r.awayScore] : [r.awayScore, r.homeScore];
      return { opponent: home ? r.away : r.home, date: r.date, us, them, forfeit: r.forfeit };
    });
  const rivals = [...Map.groupBy(meetings, (m) => m.opponent)]
    .filter(([, games]) => games.length >= 3)
    .map(([opponent, games]) => {
      const last = games.reduce((a, b) => (b.date > a.date ? b : a));
      const count = (test: (g: (typeof games)[number]) => boolean) => games.filter(test).length;
      return { opponent, games: games.length, won: count((g) => g.us > g.them), lost: count((g) => g.us < g.them), tied: count((g) => g.us === g.them), last };
    })
    .sort((a, b) => b.games - a.games || b.last.date.localeCompare(a.last.date))
    .slice(0, 6);
  const group = school.district === "0" ? "Division" : /^\d+$/.test(school.district) ? "District" : school.district;
  // A wide wordmark is drawn smaller, so it never fills the band; the logo itself is untouched (ADR 0006).
  const crestSize = identity.logo && identity.logo.aspect > 2 ? Math.max(49, Math.min(72, Math.floor(260 / identity.logo.aspect))) : 72;

  /** A game row: date, opponent (and a projection or round), score. Every game links to its page: the score is the link,
   * stretched over the row, and the opponent's name stays its own link above it. */
  const GameRow = ({ r, big = true }: { r: Row; big?: boolean }) => {
    const score = (
      <span className={`font-num font-bold tabular-nums text-ink ${big ? "text-[22px]" : "text-[19px]"}`}>
        {r.score ?? <ChevronRight aria-hidden="true" className="size-5 text-muted" />}
      </span>
    );
    return (
      <li key={r.id} className="relative border-b border-line hover:bg-panel">
        <div className="grid min-h-14 grid-cols-[4.5rem_1fr_auto] items-center gap-x-3 px-3 py-1">
          <span className="font-num text-[14px] font-bold uppercase leading-tight text-navy">{r.status}</span>
          <span className="min-w-0 text-[15px] leading-5 text-ink">
            <span className="flex items-center">
              {opponentCrest(r.opponent)}
              <span className="flex min-w-0 items-center gap-1">
                {r.home ? "vs" : "at"} {opponentLink(r.opponent)}
              </span>
            </span>
            {r.note && <span className="block text-[13px] leading-4 text-muted">{r.note}</span>}
          </span>
          {r.href ? (
            <Link
              href={r.href}
              aria-label={`${r.status} ${r.home ? "vs" : "at"} ${r.opponent}${r.score ? `, ${r.score}` : ""}, game page`}
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

  return (
    <EdgeToEdge>
      {/* data-pagefind-body: this page is in the site search (app/search). */}
      <article data-pagefind-body aria-labelledby="school" className="mx-auto max-w-3xl border-line bg-white pb-6 sm:border-x">
        <nav aria-label="Back" className="border-b border-line">
          <Link href="/programs" className="flex min-h-11 items-center gap-1.5 px-3 text-[14px] font-semibold text-navy">
            <ArrowLeft aria-hidden="true" className="size-4" strokeWidth={2.5} />
            Programs
          </Link>
        </nav>
        <header className="px-3 pb-3 pt-5" style={{ background: theme.bg, color: theme.fg, borderBottom: `6px solid ${theme.stripe ?? theme.bg}` }}>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
            <Crest school={school.school} identity={identity} size={crestSize} maxAspect={4.8} />
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
                <Stat label={`${seasons[0]} record`} sub={ranked.rated < FEW_GAMES ? `${ranked.rated} rated ${ranked.rated === 1 ? "game" : "games"}` : undefined}>
                  {record(ranked)}
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
                <p className="text-[12px] font-bold uppercase tracking-widest text-red">Next game</p>
                {next.href ? (
                  <Link href={next.href} className="flex min-h-11 items-center justify-between gap-2 text-[16px] font-semibold text-ink hover:text-navy">
                    <span>
                      {next.status} · {next.home ? "vs" : "at"} {next.opponent}
                      {next.note && <span className="block text-[14px] font-normal text-muted">{next.note}</span>}
                    </span>
                    <ChevronRight aria-hidden="true" className="size-5 shrink-0 text-muted" />
                  </Link>
                ) : (
                  <p className="text-[16px] font-semibold text-ink">
                    {next.status} · {next.home ? "vs" : "at"} {next.opponent}
                  </p>
                )}
              </div>
            )}
            {latest && (
              <div className="bg-white px-3 py-2.5">
                <p className="text-[12px] font-bold uppercase tracking-widest text-red">Latest score</p>
                <div className="flex min-h-11 items-center justify-between gap-2 text-[16px] font-semibold text-ink">
                  <span>
                    {latest.status} · {latest.home ? "vs" : "at"} {opponentLink(latest.opponent)}
                    <span className="block text-[14px] font-normal text-muted">Score not confirmed here.</span>
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

        {/* This season's games lead, right after the next and latest game: a fan mid-season wants the schedule before six seasons of history. */}
        <Section id="games" title={`${CURRENT_SEASON} games`} accent={accent} className="mt-4">
          {rows.length ? (
            <>
              <ul>
                {rows.map((r) => (
                  <GameRow key={r.id} r={r} />
                ))}
              </ul>
              {(results.length > 0 || games.some((g) => g.verification === "unconfirmed")) && (
                <p className="px-3 pt-2 text-[13px] text-muted">Season scores, not confirmed here.</p>
              )}
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
            <p className="px-3 pt-2 text-[13px] text-muted">Forfeits are left out of the figures. Season scores, not confirmed here.</p>
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
              Each week, the game that went furthest from what the ratings projected the week before. Season scores, not confirmed here.
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

        {history.length > 0 && (
          <Section id="seasons" title="Season by season" accent={accent}>
            {history.length > 1 && (
              <p className="px-3 pt-2 text-[15px] text-ink">
                <b className="font-num text-[19px] tabular-nums">{record(allTime)}</b> from {history.at(-1)!.season} to {history[0].season}
                {allTime.playoffs > 0 && ` · playoffs in ${allTime.playoffs} of ${history.length} seasons`}
              </p>
            )}
            <ul className="mt-1">
              {history.map((h) => (
                <li key={h.season} className="border-b border-line">
                  <div className="grid min-h-14 grid-cols-[3.5rem_1fr_auto] items-center gap-x-3 px-3 py-1">
                    {ranksPage ? (
                      <Link
                        href={seasonHref(h.season, seasons[0], org)}
                        aria-label={`${h.season} rankings`}
                        className="inline-flex min-h-11 items-center font-num text-[18px] font-bold text-navy underline"
                      >
                        {h.season}
                      </Link>
                    ) : (
                      <span className="inline-flex min-h-11 items-center font-num text-[18px] font-bold text-navy">{h.season}</span>
                    )}
                    <span className="min-w-0 text-[15px] leading-5 text-ink">
                      <b className="font-num text-[20px] tabular-nums">{record(h.row)}</b>
                      <span className="text-muted">
                        {" "}· #{h.place} of {h.of} in {org?.label ?? school.league}
                      </span>
                      {h.playoff && (
                        <span className="block text-[14px] font-semibold text-navy">Playoffs: reached {roundPhrase(h.playoff.round, h.playoff.league)}</span>
                      )}
                    </span>
                    <span className="text-right">
                      <span className="font-num text-[19px] font-bold tabular-nums text-ink">{signed(h.row.rating)}</span>
                      <span className="block text-[13px] font-bold uppercase leading-3 tracking-wider text-muted">rating</span>
                    </span>
                  </div>
                  {h.played.length > 0 && (
                    <details className="px-3 pb-2">
                      <summary className="flex min-h-11 cursor-pointer items-center text-[14px] font-semibold text-navy">
                        {h.season} games ({h.played.length})
                      </summary>
                      <ul className="border-t border-line">
                        {h.played.map((r) => (
                          <GameRow key={r.id} r={r} big={false} />
                        ))}
                      </ul>
                      <p className="pt-1 text-[13px] text-muted">Season scores, not confirmed here.</p>
                    </details>
                  )}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {rivals.length > 0 && (
          <Section id="rivals" title="Most played" accent={accent}>
            <p className="px-3 pt-2 text-[13px] text-muted">
              Record against each since {history.at(-1)?.season ?? seasons.at(-1)}, from scores not confirmed here.
            </p>
            <ul>
              {rivals.map((r) => (
                <li key={r.opponent} className="flex min-h-14 items-center gap-3 border-b border-line px-3">
                  <span className="min-w-0 flex-1 text-[15px] text-ink">
                    <span className="flex items-center">
                      {opponentCrest(r.opponent)}
                      {opponentLink(r.opponent)}
                    </span>
                    <span className="block pl-12 text-[13px] text-muted">
                      {r.games} games · last {r.last.date.slice(0, 4)}, {r.last.forfeit ? "forfeit" : `${r.last.us}-${r.last.them}`}
                    </span>
                  </span>
                  <span className="font-num text-[22px] font-bold tabular-nums text-ink">{record(r)}</span>
                </li>
              ))}
            </ul>
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
      </article>
    </EdgeToEdge>
  );
}
