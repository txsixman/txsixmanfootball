import Link from "next/link";
import type { ReactNode } from "react";
import { activeOrgs } from "@/lib/active-orgs";
import { loadAlignments, programFor, type Alignment } from "@/lib/alignments";
import { weekReviewDescription, weeksIndexDescription } from "@/lib/descriptions";
import { roundPhrase } from "@/lib/games";
import { projectionText } from "@/lib/projection";
import { signed } from "@/lib/ratings";
import { ORGS, type Org } from "@/lib/orgs";
import { resultSeasons, weekLabel } from "@/lib/weeks";
import { marginOf } from "@/lib/week-review";
import { indexHref, weekHref } from "@/lib/week-review-hrefs";
import { loadWeekReview, orgWeeks, reviewedWeeks, type PlacedMover, type WeekReview } from "@/lib/week-review-load";
import { TabNav } from "../tab-nav";
import { BoardRow, EmptyState, PageHeader, SectionBar } from "../ui";

// The week in review: one week of one organization (ADR 0012), from the same games, ratings and projections as the Results,
// Rankings and Playoffs pages. Robot-read scores are unconfirmed, so no row names a winner (ADR 0004); advancement is shown the
// way the bracket pages show it, from the later round's own games (ADR 0013).

type Games = WeekReview["games"][number];
const days = (r: Pick<WeekReview, "monday" | "sunday">) => `${weekLabel(r.monday)} to ${weekLabel(r.sunday)}`;

/** A team's name, linking to its program page when the alignments list it. A link is its own 44px row. */
function TeamName({ name, org, alignments }: { name: string; org: Org; alignments: Alignment[] }) {
  const slug = programFor(alignments, name, org.league)?.slug;
  return slug ? (
    <Link href={`/programs/${slug}`} prefetch={false} className="inline-flex min-h-11 items-center text-ink hover:text-navy hover:underline">
      {name}
    </Link>
  ) : (
    <span className="inline-flex min-h-11 items-center">{name}</span>
  );
}

/** Both teams and both scores in one link to the game's page, away team first. A forfeit shows the word, never the recorded score. */
function GameLink({ g }: { g: Games }) {
  const line = (team: string, score: number) => (
    <span className="flex items-center justify-between gap-3">
      <span className="min-w-0 truncate">{team}</span>
      <span className="font-num text-[20px] font-bold tabular-nums">{g.forfeit ? "" : score}</span>
    </span>
  );
  return (
    <Link
      href={g.href}
      prefetch={false}
      aria-label={`${g.away} vs ${g.home}${g.forfeit ? ", forfeit" : `, ${g.awayScore}-${g.homeScore}`}, game page`}
      className="block min-h-11 py-0.5 text-ink hover:text-navy"
    >
      {line(g.away, g.awayScore)}
      {line(g.home, g.homeScore)}
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
            <span className="sr-only">, {by > 0 ? "up" : "down"} {Math.abs(by)} places</span>
          </>
        )}
        {by === "new" && " · new in the rankings"}
      </span>
    </BoardRow>
  );
}

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
  const at = weeks.findIndex((w) => w.number === week);
  const [earlier, later] = [weeks[at - 1], weeks[at + 1]];
  const byDay = Map.groupBy(review.games, (g) => g.status);
  const team = (name: string) => <TeamName name={name} org={org} alignments={alignments} />;

  return (
    <section aria-labelledby="week">
      <PageHeader
        id="week"
        size="md"
        eyebrow={`${org.label} · ${season} season · Week ${week} · ${days(review)} · ${review.games.length} ${review.games.length === 1 ? "game" : "games"}`}
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
      <nav aria-label="Week" className="mt-3 flex flex-wrap gap-1.5">
        {weeks.map((w) => (
          <Link
            key={w.number}
            href={weekHref(season, w.number, org)}
            prefetch={false}
            aria-current={w.number === week ? "page" : undefined}
            aria-label={`Week ${w.number}, from ${weekLabel(w.monday)}`}
            className={`inline-flex size-11 items-center justify-center border-2 border-navy font-num text-[17px] font-bold ${
              w.number === week ? "bg-navy text-white" : "text-navy hover:bg-panel"
            }`}
          >
            {w.number}
          </Link>
        ))}
      </nav>
      <p className="mt-3 text-[13px] text-muted">
        Away team first. Scores may be corrected if a mistake is found. Rankings and projections use the
        ratings at the end of the week before.
      </p>

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
        note="Games whose final margin was furthest from the projected margin, from both teams' ratings at the end of the week before (once each had played four games). The number is points from the projection, counting any margin past 45 as 45 (the 45-point rule). Forfeits are left out."
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

      <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
        <Section id="closest" title="Closest games" note="The fewest points between the two scores. Forfeits are left out.">
          {review.closest.length ? (
            <ol>
              {review.closest.map((g, i) => (
                <BoardRow key={g.id} place={i + 1} figure={marginOf(g)} unit="points apart">
                  <GameLink g={g} />
                </BoardRow>
              ))}
            </ol>
          ) : (
            <EmptyState>No played game this week.</EmptyState>
          )}
        </Section>
        <Section id="margins" title="Biggest margins" note="The most points between the two scores. Forfeits are left out.">
          {review.biggest.length ? (
            <ol>
              {review.biggest.map((g, i) => (
                <BoardRow key={g.id} place={i + 1} figure={marginOf(g)} unit="points apart">
                  <GameLink g={g} />
                </BoardRow>
              ))}
            </ol>
          ) : (
            <EmptyState>No played game this week.</EmptyState>
          )}
        </Section>
      </div>

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
      <PageHeader id="weeks" size="md" eyebrow={`${org.label} · ${seasons.at(-1)} to ${seasons[0]}`} title="Week in review" note="Rating movers, results furthest from the projection, the closest games and biggest margins, and playoff advancement, week by week." />
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
