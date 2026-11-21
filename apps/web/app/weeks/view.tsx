import Link from "next/link";
import type { ReactNode } from "react";
import { activeOrgs } from "@/lib/active-orgs";
import { loadAlignments, programFor, type Alignment } from "@/lib/alignments";
import { weekReviewDescription, weeksIndexDescription } from "@/lib/descriptions";
import { roundPhrase } from "@/lib/games";
import { chanceText, projectionText } from "@/lib/projection";
import { signed } from "@/lib/ratings";
import { ORGS, type Org } from "@/lib/orgs";
import { resultSeasons, weekLabel } from "@/lib/weeks";
import { marginOf } from "@/lib/week-review";
import { indexHref, weekHref } from "@/lib/week-review-hrefs";
import { weekNeighbours } from "@/lib/neighbours";
import { loadWeekReview, orgWeeks, reviewedWeeks, type Milestone, type PlacedMover, type RecapStreak, type WeekReview } from "@/lib/week-review-load";
import { TabNav } from "../tab-nav";
import { aOrAn, plural } from "@/lib/plural";
import { WeekStrip } from "../week-strip";
import { BoardRow, EmptyState, PageHeader, SectionBar } from "../ui";

// The week in review: one week of one organization (ADR 0012), from the same games, ratings and projections as the Results,
// Rankings and Playoffs pages. A final score is confirmed (ADR 0040), so the recap sections name winners; a game the sources
// dispute names none and is left out of them (ADR 0092). Every line is counted from the data, never written; advancement is
// shown the way the bracket pages show it, from the later round's own games (ADR 0013).

type Games = WeekReview["games"][number];
const UPSETS_SHOWN = 8;
const days = (r: Pick<WeekReview, "monday" | "sunday">) => `${weekLabel(r.monday)} to ${weekLabel(r.sunday)}`;

/** A team's name, linking to its program page when the alignments list it. A link is its own 44px row. */
function TeamName({ name, org, alignments }: { name: string; org: Org; alignments: Alignment[] }) {
  const slug = programFor(alignments, name, org.league)?.slug;
  return slug ? (
    <Link href={`/programs/${slug}`} prefetch={false} className="ink-link min-w-11">
      {name}
    </Link>
  ) : (
    <span className="inline-flex min-h-11 items-center">{name}</span>
  );
}

/** Both teams and both scores in one link to the game's page, away team first. A forfeit shows the word, never the recorded score. */
function GameLink({ g }: { g: Games }) {
  const line = (team: string, score: number) => (
    <span className="row-between">
      <span className="min-w-0 break-words">{team}</span>{" "}
      <span className="font-num text-[20px] font-bold tabular-nums">{g.forfeit ? "" : score}</span>
    </span>
  );
  return (
    <Link
      href={g.href}
      prefetch={false}
      // The name holds the visible text whole, in its order (WCAG 2.5.3, label in name): each team with its own score.
      aria-label={g.forfeit ? `${g.away}, ${g.home}, forfeit, game page` : `${g.away} ${g.awayScore}, ${g.home} ${g.homeScore}, game page`}
      className="blk-link"
    >
      {line(g.away, g.awayScore)}{" "}
      {line(g.home, g.homeScore)}{" "}
      {g.forfeit && <span className="block text-[13px] font-semibold text-muted">Forfeit</span>}
    </Link>
  );
}

function Mover({ m, i, org, alignments }: { m: PlacedMover; i: number; org: Org; alignments: Alignment[] }) {
  const by = m.moved;
  return (
    <BoardRow place={i + 1} figure={signed(m.change)} unit="rating points this week">
      <TeamName name={m.team} org={org} alignments={alignments} />
      <span className="block text-[13px] text-muted">
        Rating {signed(m.rating)}, was {signed(m.was)}
        {m.place > 0 && ` · ${org.label} rank ${m.place}`}
        {typeof by === "number" && by !== 0 && (
          <>
            <span aria-hidden="true"> {by > 0 ? "▲" : "▼"}{Math.abs(by)}</span>
            <span className="sr-only">, {by > 0 ? "up" : "down"} {plural(Math.abs(by), "place")}</span>
          </>
        )}
        {by === "new" && " · new in the rankings"}
      </span>
    </BoardRow>
  );
}

/** The week in one line, counted from the lists below: "18 games: 2 upsets, 3 decided by one score or less." */
function recapLine(r: WeekReview) {
  const n = r.upsets.length;
  const bits = [r.judged ? `${n} ${n === 1 ? "upset" : "upsets"}` : undefined, `${r.oneScore.length} decided by one score or less`].filter(Boolean);
  return `${r.games.length} ${r.games.length === 1 ? "game" : "games"}: ${bits.join(", ")}.`;
}

/** "Final: Oglesby by 52", or "Final: tied" for a tie. */
const finalLine = (g: Games) => (g.homeScore === g.awayScore ? "Final: tied" : `Final: ${g.homeScore > g.awayScore ? g.home : g.away} by ${marginOf(g)}`);

const STREAK_TEXT = {
  ended: (s: RecapStreak) => `${s.kind === "win" ? "Winning" : "Losing"} streak of ${s.length} games ended`,
  reached: (s: RecapStreak) => `Has now won ${s.length} games in a row`,
};

const MILESTONE_TEXT: Record<Milestone["kind"], (m: Milestone) => string> = {
  "state-game": () => "First State Championship game in the records held here",
  "playoff-win": () => "First playoff win in the results held here",
  "first-loss": (m) => `First loss of the season, after ${plural(m.unbeaten ?? 0, "game")} with no loss`,
};

const Section = ({ id, title, note, children }: { id: string; title: string; note: string; children: ReactNode }) => (
  <section aria-labelledby={id} className="mt-8 min-w-0">
    <SectionBar id={id} title={title} className="" />
    <p className="mt-2 text-[13px] leading-5 text-muted">{note}</p>
    {children}
  </section>
);

const Sub = ({ children }: { children: ReactNode }) => (
  <h3 className="mt-4 border-b-2 border-navy pb-1 font-num text-[16px] font-bold uppercase tracking-wider text-navy">{children}</h3>
);

/** The meta description of a weeks page: an organization's index, or one of its weeks. */
export async function describeWeeks(org: Org, week?: { season: number; week: number }) {
  if (week) {
    const found = (await reviewedWeeks(week.season, org)).find((w) => w.number === week.week);
    return weekReviewDescription({ org: org.label, season: week.season, week: week.week, games: found?.games.length ?? 0 });
  }
  const seasons = await resultSeasons(org);
  return weeksIndexDescription({ org: org.label, first: seasons.at(-1), latest: seasons[0] });
}

/** One week of one organization, reviewed. The page exists only for a week with a game (app/weeks/paths.ts). */
export async function WeekInReview({ org, season, week }: { org: Org; season: number; week: number }) {
  const [review, alignments, seasons, orgs] = await Promise.all([loadWeekReview(org, season, week) as Promise<WeekReview>, loadAlignments(), resultSeasons(org), activeOrgs(org)]);
  const [weeks, orgWeeksPlayed] = await Promise.all([reviewedWeeks(season, org), Promise.all(orgs.map(async (o) => [o, await reviewedWeeks(season, o)] as const))]);
  const lastOf = async (s: number) => (await reviewedWeeks(s, org)).at(-1)!.number;
  // A season's tab opens its last week; the tab of the season being read stays on this week, so it is the current one.
  const seasonTabs = await Promise.all(seasons.map(async (s) => ({ href: weekHref(s, s === season ? week : await lastOf(s), org), label: String(s) })));
  const { rankings } = await weekNeighbours({ season, week, org });
  const at = weeks.findIndex((w) => w.number === week);
  const [earlier, later] = [weeks[at - 1], weeks[at + 1]];
  const byDay = Map.groupBy(review.games, (g) => g.status);
  const team = (name: string) => <TeamName name={name} org={org} alignments={alignments} />;

  return (
    <section aria-labelledby="week">
      <PageHeader
        id="week"
        size="md"
        eyebrow={`${org.label} · ${season} season · Week ${week} · ${days(review)} · ${plural(review.games.length, "game")}`}
        title="Week in review"
      />
      <TabNav
        label="Organization"
        tabs={orgWeeksPlayed
          .filter(([, played]) => played.length)
          .map(([o, played]) => ({ href: played.some((w) => w.number === week) ? weekHref(season, week, o) : weekHref(season, played.at(-1)!.number, o), label: o.label }))}
        current={weekHref(season, week, org)}
      />
      {seasons.length > 1 && <TabNav label="Season" wrap tabs={seasonTabs} current={weekHref(season, week, org)} />}
      <WeekStrip prefetch={false} weeks={weeks.map((w) => ({ number: w.number, href: weekHref(season, w.number, org), label: `Week ${w.number}, from ${weekLabel(w.monday)}`, current: w.number === week }))} />
      <p className="mt-3 text-[13px] text-muted">
        Away team first. Scores may be corrected if a mistake is found. Rankings and projections use the
        ratings at the end of the week before.
      </p>
      <p className="mt-1 text-[14px] font-semibold text-ink">{recapLine(review)}</p>

      <Section
        id="upsets"
        title="Upsets"
        note="Games the team with the lower chance to win won, using the ratings at the end of the week before (once each team had four rated games). Forfeits and disputed finals are left out."
      >
        {review.upsets.length ? (
          <>
            <ol>
              {review.upsets.slice(0, UPSETS_SHOWN).map((u, i) => (
                <BoardRow key={u.game.id} place={i + 1} figure={chanceText(u.chance)} unit="chance to win before the game">
                  <GameLink g={u.game} />
                  <span className="block pb-1 text-[13px] text-muted">
                    {u.winner} had {aOrAn(chanceText(u.chance))} {chanceText(u.chance)} chance to win. {finalLine(u.game)}.
                  </span>
                </BoardRow>
              ))}
            </ol>
            {review.upsets.length > UPSETS_SHOWN && (
              <p className="py-2 text-[13px] text-muted">{review.upsets.length - UPSETS_SHOWN} more {review.upsets.length - UPSETS_SHOWN === 1 ? "upset" : "upsets"}, each with a higher chance to win.</p>
            )}
          </>
        ) : (
          <EmptyState>
            {review.judged ? "No game this week went to the team with the lower chance to win." : "No game this week had a projection to compare with."}
          </EmptyState>
        )}
      </Section>

      <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
        <Section id="margins" title="Biggest wins" note="The wins by the most points. Forfeits, ties and disputed finals are left out.">
          {review.wins.length ? (
            <ol>
              {review.wins.map((w, i) => (
                <BoardRow key={w.game.id} place={i + 1} figure={w.margin} unit="points apart">
                  <GameLink g={w.game} />
                  <span className="block pb-1 text-[13px] text-muted">{finalLine(w.game)}</span>
                </BoardRow>
              ))}
            </ol>
          ) : (
            <EmptyState>No played game this week.</EmptyState>
          )}
        </Section>
        <Section id="closest" title="Closest games" note="Games decided by one score or less: eight points or fewer, a touchdown and a two-point conversion. Forfeits and disputed finals are left out.">
          {review.oneScore.length ? (
            <ol>
              {review.oneScore.map((g, i) => (
                <BoardRow key={g.id} place={i + 1} figure={marginOf(g)} unit="points apart">
                  <GameLink g={g} />
                  <span className="block pb-1 text-[13px] text-muted">{finalLine(g)}</span>
                </BoardRow>
              ))}
            </ol>
          ) : (
            <EmptyState>No game this week was decided by one score or less.</EmptyState>
          )}
        </Section>
      </div>

      {review.streaks.length > 0 && (
        <Section
          id="streaks"
          title="Streaks"
          note={`${org.label} teams whose run of games in a row ended this week (five or more), or whose winning run reached five, ten, fifteen and on. A tie ends a run, and so does a season with none of the team's games.`}
        >
          <ol>
            {review.streaks.map((s, i) => (
              <BoardRow key={`${s.team}-${s.change}`} place={i + 1} figure={s.length} unit="games in a row">
                <TeamName name={s.team} org={org} alignments={alignments} />
                <span className="block text-[13px] text-muted">{STREAK_TEXT[s.change](s)}</span>
                <GameLink g={s.game} />
              </BoardRow>
            ))}
          </ol>
        </Section>
      )}

      {review.milestones.length > 0 && (
        <Section
          id="milestones"
          title="Milestones"
          note="Firsts in the data held here: playoff games and State Championship games since 2018 (UIL's State Championship games since 1972), and a team's first loss of the season after at least four games with none."
        >
          <ul>
            {review.milestones.map((m) => (
              <li key={`${m.kind}-${m.team}`} className="border-b border-line px-3 py-1 text-[15px] leading-5 text-ink">
                <TeamName name={m.team} org={org} alignments={alignments} />
                <span className="block text-[13px] text-muted">{MILESTONE_TEXT[m.kind](m)}</span>
                <GameLink g={m.game} />
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section
        id="movers"
        title="Rating movers"
        note={`The teams whose rating rose or fell most over the week, with ${org.label} rank now. Only teams with at least four rated games are counted.`}
      >
        {review.rises.length || review.drops.length ? (
          <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
            {[
              { name: "Biggest rises", list: review.rises, none: "No team rose." },
              { name: "Biggest drops", list: review.drops, none: "No team dropped." },
            ].map(({ name, list, none }) => (
              <div key={name} className="min-w-0">
                <Sub>{name}</Sub>
                {list.length ? (
                  <ol>
                    {list.map((m, i) => (
                      <Mover key={m.team} m={m} i={i} org={org} alignments={alignments} />
                    ))}
                  </ol>
                ) : (
                  <p className="py-3 text-[14px] text-muted">{none}</p>
                )}
              </div>
            ))}
          </div>
        ) : (
          <EmptyState>
            {review.tracked ? `No ${org.label} team moved this week.` : "Ratings are tracked week by week from the fourth week of the season, so there are no moves to show yet."}
          </EmptyState>
        )}
      </Section>

      <Section
        id="projection"
        title="Furthest from the projection"
        note="Games whose final margin was furthest from the projected margin, from both teams' ratings at the end of the week before (once each had four rated games; forfeits never count). The number is points from the projection, counting any margin past 45 as 45 (the 45-point rule). Forfeits are left out."
      >
        {review.furthest.length ? (
          <ol>
            {review.furthest.map((o, i) => (
              <BoardRow key={o.game.id} place={i + 1} figure={Math.round(o.gap)} unit="points from the projection">
                <GameLink g={o.game} />
                <span className="block pb-1 text-[13px] text-muted">Projected: {projectionText(o.projection)}</span>
              </BoardRow>
            ))}
          </ol>
        ) : (
          <EmptyState>No game this week had a projection to compare with.</EmptyState>
        )}
      </Section>

      <Section
        id="advancement"
        title="Playoff advancement"
        note="Each bracket round played this week, and the teams from it that have a game listed in a later round. A team with no later game listed may simply not be scheduled yet."
      >
        {review.advanced.length ? (
          review.advanced.map((a) => (
            <div key={`${a.bracket}-${a.round}`} className="mt-4">
              <Sub>
                {a.bracket} · {a.label} <span className="font-sans text-[13px] font-normal normal-case tracking-normal text-muted">· {a.games} {a.games === 1 ? "game" : "games"} played</span>
              </Sub>
              {a.wentOn.map((w) => (
                <div key={w.round} className="pt-2">
                  <p className="text-[14px] font-semibold text-ink">Listed in {roundPhrase(w.round, org.league)}:</p>
                  <ul className="flex flex-wrap gap-x-4">
                    {w.teams.map((t) => (
                      <li key={t}>{team(t)}</li>
                    ))}
                  </ul>
                </div>
              ))}
              {a.last ? (
                <p className="pt-2 text-[14px] text-muted">This is the last round of the bracket.</p>
              ) : (
                a.unlisted > 0 && (
                  <p className="pt-2 text-[14px] text-muted">
                    {a.wentOn.length ? `${a.unlisted} more ${a.unlisted === 1 ? "team has" : "teams have"} no` : "No team has a"} later-round game listed yet.
                  </p>
                )
              )}
            </div>
          ))
        ) : (
          <EmptyState>No {org.label} playoff games this week.</EmptyState>
        )}
        <Link href="/playoffs" className="link-more">All playoff brackets</Link>
      </Section>

      <Section id="games" title="Every game" note={`All ${review.games.length} ${org.label} ${review.games.length === 1 ? "game" : "games"} of the week, each linked to its game page.`}>
        {[...byDay].map(([day, games]) => (
          <div key={day}>
            <Sub>{day}</Sub>
            <ul className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
              {games.map((g) => (
                <li key={g.id} className="min-w-0 border-b border-line py-1 text-[15px]">
                  <GameLink g={g} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </Section>

      <nav aria-label="Other weeks" className="mt-8 flex flex-wrap gap-x-5">
        {earlier && (
          <Link href={weekHref(season, earlier.number, org)} className="link-more">
            Week {earlier.number} in review
          </Link>
        )}
        {later && (
          <Link href={weekHref(season, later.number, org)} className="link-more">
            Week {later.number} in review
          </Link>
        )}
        <Link href={indexHref(org)} className="link-more">
          Every week
        </Link>
        <Link href={`/results/${season}/${week}${org === ORGS[0] ? "" : `/${org.slug}`}`} className="link-more">
          Week {week} results
        </Link>
        {rankings && (
          <Link href={rankings.href} className="link-more">
            {rankings.label}
          </Link>
        )}
      </nav>
    </section>
  );
}

/** Every week with a game for one organization, newest season first, each linking to its review. */
export async function WeeksIndex({ org }: { org: Org }) {
  const [seasons, orgs] = await Promise.all([resultSeasons(org), activeOrgs(org)]);
  const bySeason = await Promise.all(seasons.map(async (s) => [s, await orgWeeks(s, org)] as const));
  const latest = bySeason[0]?.[1].filter((w) => w.games.length).at(-1);
  return (
    <section aria-labelledby="weeks">
      <PageHeader id="weeks" size="md" eyebrow={`${org.label} · ${seasons.at(-1)} to ${seasons[0]}`} title="Week in review" note="Upsets, biggest wins, closest games, streaks, milestones, rating movers, results furthest from the projection and playoff advancement, week by week." />
      <TabNav label="Organization" tabs={orgs.map((o) => ({ href: indexHref(o), label: o.label }))} current={indexHref(org)} />
      {latest && (
        <Link href={weekHref(seasons[0], latest.number, org)} className="btn mt-4 w-full sm:w-auto">
          Latest: {seasons[0]} week {latest.number}
        </Link>
      )}
      {bySeason.map(([season, weeks]) => (
        <section key={season} aria-labelledby={`season-${season}`} className="mt-6">
          <SectionBar id={`season-${season}`} title={`${season} season`} className="" />
          <nav aria-label={`${season} weeks`} className="mt-3 flex flex-wrap gap-1.5">
            {[...weeks].reverse().filter((w) => w.games.length).map((w) => (
              <Link
                key={w.number}
                href={weekHref(season, w.number, org)}
                prefetch={false}
                aria-label={`${season} week ${w.number}, from ${weekLabel(w.monday)}`}
                className="inline-flex size-11 items-center justify-center border-2 border-navy font-num text-[17px] font-bold text-navy hover:bg-panel"
              >
                {w.number}
              </Link>
            ))}
          </nav>
        </section>
      ))}
    </section>
  );
}
