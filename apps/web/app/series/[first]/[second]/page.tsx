import { ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import type { ReactNode } from "react";
import { heading, loadAlignments, slugify } from "@/lib/alignments";
import { finalScore, loadFinals } from "@/lib/champions";
import { seriesDescription } from "@/lib/descriptions";
import { isDisputed, loadDisputed } from "@/lib/disputed";
import { playoffLabels, mediumDate } from "@/lib/game-pages";
import { gameKey } from "@/lib/games";
import { EMPTY, loadIdentities } from "@/lib/identity";
import { loadLineage } from "@/lib/lineage";
import { pairKey } from "@/lib/meetings";
import { projectionParts, project } from "@/lib/projection";
import { loadRatings, ratingSeasons, record } from "@/lib/ratings";
import { biggestWins, finalsBetween, longestStreak, recordWords, seriesHref, seriesRecord, type SeriesGame } from "@/lib/series";
import { loadSeries, successors, upcomingMeetings } from "@/lib/series-data";
import { plural } from "@/lib/plural";
import { Breadcrumbs } from "../../../breadcrumbs";
import { Crest } from "../../../programs/crest";
import { EdgeToEdge, SectionBar } from "../../../ui";
import { seriesTitle } from "@/lib/titles";

// The games of one pair of programs, FIRST_SEASON on (ADR 0013, ADR 0097): the series in words, the last meeting, the longest
// streak, each side's biggest win, the playoff meetings, every meeting and the next one when it is set. A game row names no
// winner (ADR 0040: the game page does); the record counts a forfeit and leaves a disputed final out. The address is the two
// program slugs in alphabetical order; the reversed address is built too, as a permanent redirect, so a pair has one page.
type Props = { params: Promise<{ first: string; second: string }> };

export const dynamicParams = false;
export const generateStaticParams = async () => (await loadSeries()).flatMap(({ first, second }) => [{ first, second }, { first: second, second: first }]);

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
  if (first > second) return { title: "Series" }; // the reversed address only redirects
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
  if (first > second) permanentRedirect(seriesHref(first, second));
  const s = await load({ first, second });
  if (!s) notFound();
  const { a, b, games, since, projection } = s;
  const seasonsOf = [...new Set(games.map((g) => g.season))];
  const [identities, lineage, allFinals, labels, disputes, back, upcoming] = await Promise.all([
    loadIdentities(),
    loadLineage(),
    loadFinals(),
    Promise.all(seasonsOf.map(async (season) => [season, await playoffLabels(season)] as const)).then((l) => new Map(l)),
    Promise.all(seasonsOf.map(async (season) => [season, await loadDisputed(season)] as const)).then((l) => new Map(l)),
    successors(),
    upcomingMeetings(),
  ]);
  const finals = finalsBetween(allFinals, first, second, lineage);
  // Each game as the series rules read it: a merged school's old name counts as the program it became (ADR 0003), a disputed
  // final is listed and never counted (ADR 0097). `games` is oldest first and is shared: nothing here mutates it.
  const slugOf = (name: string) => {
    const slug = slugify(name);
    return back.has(slug) ? slugify(back.get(slug)!) : slug;
  };
  const read = games.map((g): SeriesGame & { g: (typeof games)[number] } => ({
    g,
    date: g.result.date,
    home: slugOf(g.result.home),
    away: slugOf(g.result.away),
    homeScore: g.result.homeScore,
    awayScore: g.result.awayScore,
    forfeit: g.result.forfeit,
    disputed: !g.result.forfeit && isDisputed(disputes.get(g.season)!, g.result.date, g.result.home, g.result.away),
  }));
  const total = seriesRecord(first, read);
  const notCounted = read.filter((r) => r.disputed).length;
  const streak = longestStreak(first, read);
  const biggest = biggestWins(first, read);
  const label = (season: number, r: (typeof games)[number]["result"]) => labels.get(season)?.get(gameKey(r.date, r.home, r.away));
  const playoffGames = games.filter(({ season, result }) => label(season, result));
  const playoffs = playoffGames.length;
  // Newest first. `games` is oldest first and is shared: copy before reversing.
  const meetings = [...games].reverse();
  const last = meetings[0].result;
  const next = upcoming.get(pairKey(first, second))?.[0];
  const title = `${a.school} vs ${b.school}`;
  const name = (who: "first" | "second") => (who === "first" ? a.school : b.school);
  /** "Guthrie vs Jayton, 14-42": away team first, the score away-home as every game list writes it; a forfeit is the word. */
  const gameText = (r: (typeof games)[number]["result"]) => `${r.away} vs ${r.home}, ${r.forfeit ? "forfeit" : `${r.awayScore}-${r.homeScore}`}`;
  const years = (from: string, to: string) => (from.slice(0, 4) === to.slice(0, 4) ? from.slice(0, 4) : `${from.slice(0, 4)} to ${to.slice(0, 4)}`);
  /** A fact of the glance list whose answer is a game: one 44 px link to its page, the date first. */
  const GameLink = ({ g, text }: { g: (typeof games)[number]; text: string }) => (
    <Link href={g.result.href} prefetch={false} className="flex min-h-11 items-center gap-x-3 py-1 text-[16px] leading-6 text-navy underline underline-offset-2 hover:text-red">
      <span className="font-num text-[14px] font-bold uppercase text-navy">{mediumDate(g.result.date)}</span>
      <span className="min-w-0 text-ink">{text}</span>
    </Link>
  );
  const Fact = ({ label: term, children }: { label: string; children: ReactNode }) => (
    <div className="border-b border-line px-3 py-1.5">
      <dt className="text-[12px] font-bold uppercase tracking-widest text-muted">{term}</dt>
      <dd className="text-[16px] leading-6 text-ink">{children}</dd>
    </div>
  );
  /** One meeting of a list: date, Away vs Home, the round it was played in, the score, and a link to its game page. */
  const Meeting = ({ season, result: r, disputed }: (typeof games)[number] & { disputed: boolean }) => {
    const round = label(season, r);
    const where = round ? `${season} playoffs · ${round}` : `${season} season`;
    return (
      <li className="border-b border-line">
        <Link
          href={r.href}
          prefetch={false}
          // The name holds the visible text whole, in its order (WCAG 2.5.3, label in name).
          aria-label={`${mediumDate(r.date)}, ${r.away} vs ${r.home}, ${where}, ${r.forfeit ? "forfeit" : `${r.awayScore}-${r.homeScore}`}${disputed ? ", score reported, not counted" : ""}, game page`}
          className="grid min-h-14 grid-cols-[6.75rem_1fr_auto_auto] items-center gap-x-3 px-3 py-1 hover:bg-panel"
        >
          <span className="font-num text-[14px] font-bold uppercase leading-tight text-navy">{mediumDate(r.date)}</span>{" "}
          <span className="min-w-0 text-[15px] leading-5 text-ink">
            {r.away} vs {r.home}{" "}
            <span className="note-13">{where}{disputed ? " · score reported, not counted" : ""}</span>
          </span>{" "}
          <span className="font-num text-[19px] font-bold tabular-nums text-ink">{r.forfeit ? "Forfeit" : `${r.awayScore}-${r.homeScore}`}</span>
          <ChevronRight aria-hidden="true" className="size-4 text-muted" />
        </Link>
      </li>
    );
  };
  const disputedIn = new Set(read.filter((r) => r.disputed).map((r) => r.g.result.id));
  const matchup = `/matchup?a=${first}&b=${second}`;

  const Team = ({ school, slug, group }: { school: string; slug: string; group: string }) => (
    <Link href={`/programs/${slug}`} prefetch={false} className="flex min-h-11 flex-col items-start gap-1.5 text-navy hover:underline">
      <Crest school={school} identity={identities.get(slug) ?? EMPTY} size={56} decorative />
      <span className="font-num text-[24px] font-bold uppercase leading-[1.05] tracking-wide [overflow-wrap:anywhere]">{school}</span>
      <span className="text-[12px] font-bold uppercase leading-4 tracking-widest text-muted no-underline">{group}</span>
    </Link>
  );

  return (
    <EdgeToEdge>
    <article aria-labelledby="series" className="mx-auto max-w-3xl border-line bg-page pb-6 sm:border-x">
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
          <b className="font-num text-[22px] leading-7 [overflow-wrap:anywhere]">{recordWords(a.school, b.school, total)}</b>
          <span className="text-muted">{` · ${plural(games.length, "meeting")} since ${since}${playoffs > 0 ? `, ${playoffs} in the playoffs` : ""}`}</span>
        </p>
        <p className="pt-1 text-[13px] text-muted">A forfeit counts as a win or a loss.</p>
        {notCounted > 0 && (
          <p className="pt-1 text-[13px] text-muted">
            {notCounted === 1 ? "One final is" : `${notCounted} finals are`} listed with the score reported and left out of the record: the sources do not agree on who won.
          </p>
        )}
      </header>

      <section aria-labelledby="glance" className="mt-4">
        <SectionBar id="glance" title="At a glance" className="mt-2" />
        <dl>
          {next && (
            <Fact label="Next meeting">
              <Link href={`/scores/${next.id}`} prefetch={false} className="flex min-h-11 flex-wrap items-center gap-x-3 py-1 text-[16px] leading-6 text-navy underline underline-offset-2 hover:text-red">
                <span className="font-num text-[14px] font-bold uppercase text-navy">{next.date ? mediumDate(next.date) : "Day not set yet"}</span>
                <span className="min-w-0 text-ink">
                  {next.away.name} vs {next.home.name} <span className="text-[13px] text-muted">{next.league}</span>
                </span>
              </Link>
            </Fact>
          )}
          <Fact label="Last meeting">
            <GameLink g={meetings[0]} text={gameText(last)} />
          </Fact>
          <Fact label="Longest streak">
            {streak ? (
              <>
                {name(streak.who)} won {streak.length} in a row, {years(streak.from.date, streak.to.date)}
                {streak.current ? " (still going)" : ""}
              </>
            ) : (
              <span className="text-muted">Neither team has won two in a row.</span>
            )}
          </Fact>
          {(["first", "second"] as const).map((who) => {
            const win = biggest[who];
            const [winner, loser] = who === "first" ? [a.school, b.school] : [b.school, a.school];
            return (
              <Fact key={who} label={`Biggest ${name(who)} win`}>
                {win ? (
                  <GameLink g={win.g} text={`${winner} ${Math.max(win.homeScore, win.awayScore)}, ${loser} ${Math.min(win.homeScore, win.awayScore)}`} />
                ) : (
                  <span className="text-muted">No win by points yet.</span>
                )}
              </Fact>
            );
          })}
        </dl>
        <p className="px-3 pt-1 text-[13px] text-muted">A forfeit has no margin, so it is never a biggest win.</p>
      </section>

      {playoffs > 0 && (
        <section aria-labelledby="playoff-meetings" className="mt-6">
          <SectionBar id="playoff-meetings" title="Playoff meetings" aside="Newest first" className="mt-2" />
          <ul>
            {[...playoffGames].reverse().map((m) => (
              <Meeting key={m.result.id} {...m} disputed={disputedIn.has(m.result.id)} />
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="meetings" className="mt-6">
        <SectionBar id="meetings" title="Every meeting" aside="Newest first" className="mt-2" />
        <ul>
          {meetings.map((m) => (
            <Meeting key={m.result.id} {...m} disputed={disputedIn.has(m.result.id)} />
          ))}
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
