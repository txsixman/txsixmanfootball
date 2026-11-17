import Link from "next/link";
import type { ReactNode } from "react";
import { loadAlignments, programFor } from "@/lib/alignments";
import { leadersDescription } from "@/lib/descriptions";
import { EMPTY, loadIdentities } from "@/lib/identity";
import { type Boards, type GameEntry, HIGH_SCORE, LEADER_VIEWS, type LeaderView, leadersHref, MERCY_MARGIN, SEASON_MIN_GAMES, type TeamEntry, topRows } from "@/lib/leaders";
import { leaderPages, leaderSeasons, loadLeaders } from "@/lib/leaders-load";
import { LEADER_MIN_GAMES } from "@/lib/season-leaders";
import { leadersTitle } from "@/lib/titles";
import { TabNav } from "../tab-nav";
import { BoardRow, CrestSlot, PageHeader, SectionBar } from "../ui";

// Team scoring leaders for one season and one view (ADR 0101), from confirmed final scores only. One organization at a time
// (ADR 0012), UIL by division. Teams only: no player is named or counted (CLAUDE.md, minors).

const day = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const oneDecimal = (n: number) => n.toFixed(1);
const signedDecimal = (n: number) => `${n > 0 ? "+" : n < 0 ? "-" : ""}${Math.abs(n).toFixed(1)}`;
const noun = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

/** The title and meta description of a page, from the same words the page uses. */
export const describeLeaders = ({ season, view }: { season: number; view: LeaderView }) => ({
  title: leadersTitle({ label: view.name, season }),
  description: leadersDescription({ label: view.name, season }),
});

type Teams = (name: string) => ReactNode;

/** A list: its bar, a note, the first ten rows, and a line for a tie that runs past them. */
function Board<T extends { place: number }>({
  id,
  title,
  note,
  rows,
  what,
  empty,
  children,
}: {
  id: string;
  title: string;
  note?: string;
  rows: readonly T[];
  what: string;
  empty: string;
  children: (shown: T[]) => ReactNode;
}) {
  const { shown, more, place } = topRows(rows);
  return (
    <section aria-labelledby={id} className="mt-8">
      <SectionBar id={id} title={title} className="" />
      {note && <p className="px-3 pt-2 text-[13px] leading-[1.35] text-muted">{note}</p>}
      {shown.length ? (
        <>
          <ol aria-labelledby={id}>{children(shown)}</ol>
          {more > 0 && (
            <p className="border-b border-line px-3 py-3 text-[14px] text-muted">
              and {more} more {what} tied at {place}
            </p>
          )}
        </>
      ) : (
        <p className="border-b border-line px-3 py-3 text-[15px] text-muted">{empty}</p>
      )}
    </section>
  );
}

/** A team list: each row is the team (linked to its program), its games, and the one figure the list ranks. */
function TeamBoard({
  id,
  title,
  note,
  rows,
  team,
  figure,
  unit,
  empty,
}: {
  id: string;
  title: string;
  note?: string;
  rows: readonly TeamEntry[];
  team: Teams;
  figure: (value: number) => ReactNode;
  unit: string;
  empty: string;
}) {
  return (
    <Board id={id} title={title} note={note} rows={rows} what="teams" empty={empty}>
      {(shown) =>
        shown.map((r) => (
          <BoardRow key={r.team} place={r.place} figure={figure(r.value)} unit={unit}>
            {team(r.team)}
            <span className="note-13s">
              {noun(r.games, "game")}
              {r.tied && " · tied"}
            </span>
          </BoardRow>
        ))
      }
    </Board>
  );
}

/** A team's score in one game, and its game page. */
function GameBoard({ rows, team }: { rows: readonly GameEntry[]; team: Teams }) {
  return (
    <Board id="single" title="Most points in one game" rows={rows} what="games" empty="No games yet.">
      {(shown) =>
        shown.map((g) => (
          <BoardRow key={`${g.date}-${g.team}`} place={g.place} figure={g.points} unit="points">
            {team(g.team)}
            <span className="note-13s">
              {g.points}-{g.against} vs {g.opponent}
              {g.tied && " · tied"}
            </span>
            <span className="flex flex-wrap items-center gap-x-3 text-[13px] text-muted">
              {day(g.date)}
              <Link
                href={g.href}
                prefetch={false}
                aria-label={`${g.team} ${g.points}, ${g.opponent} ${g.against}, game page`}
                className="inline-flex min-h-11 items-center font-semibold text-navy underline underline-offset-2"
              >
                Game page
              </Link>
            </span>
          </BoardRow>
        ))
      }
    </Board>
  );
}

/** The sentence that says what was left out. */
function leftOut({ forfeits, disputed }: Boards["left"]): string {
  const parts = [forfeits && noun(forfeits, "forfeit"), disputed && noun(disputed, "disputed final")].filter(Boolean);
  return parts.length ? `${parts.join(" and ")} left out.` : "No forfeit or disputed final to leave out.";
}

export async function LeadersView({ season, view }: { season: number; view: LeaderView }) {
  const [boards, alignments, identities, seasons, pages] = await Promise.all([loadLeaders(season, view), loadAlignments(), loadIdentities(), leaderSeasons(), leaderPages()]);
  const latest = seasons[0];
  const min = LEADER_MIN_GAMES;
  const team: Teams = (name) => {
    const slug = programFor(alignments, name, view.org.league)?.slug;
    const crest = <CrestSlot school={name} identity={(slug && identities.get(slug)) || EMPTY} />;
    return slug ? (
      <Link href={`/programs/${slug}`} prefetch={false} className="lead-link">
        {crest}
        {name}
      </Link>
    ) : (
      <b className="flex min-h-11 items-center leading-tight">
        {crest}
        {name}
      </b>
    );
  };
  // The tabs link only to pages that exist: a season in which the organization had no game has no page.
  const here = pages.filter((p) => p.season === season).map((p) => p.view);
  const orgViews = here.filter((v) => !("division" in v));
  const seasonViews = pages.filter((p) => p.view === view).map((p) => p.season);
  const href = (v: LeaderView) => leadersHref(season, latest, v);

  return (
    <section aria-labelledby="leaders" className="max-w-3xl">
      <PageHeader
        id="leaders"
        eyebrow={`${season} season · ${view.name} · ${boards.counted.toLocaleString("en-US")} games`}
        title="Scoring leaders"
        size="md"
        note={`Teams only, from final scores. ${leftOut(boards.left)} A team needs ${min} games to be listed. Playoff games count. Scores may be corrected if a mistake is found.`}
      />
      <p className="mt-2 max-w-prose text-[14px] leading-5 text-muted">
        A game ends early once one team leads by {MERCY_MARGIN} points at halftime or later, so points per game understates the best teams: they stop scoring before the clock runs out.
      </p>
      {seasonViews.length > 1 && (
        <TabNav label="Season" wrap tabs={seasonViews.map((s) => ({ href: leadersHref(s, latest, view), label: String(s) }))} current={href(view)} />
      )}
      <TabNav label="Leaders by organization" tabs={orgViews.map((v) => ({ href: href(v), label: v.org.label }))} current={href(LEADER_VIEWS.find((v) => v.org === view.org && !("division" in v))!)} />
      {view.org === LEADER_VIEWS[0].org && (
        <TabNav label="Leaders by division" tabs={here.filter((v) => v.org === view.org).map((v) => ({ href: href(v), label: v.label }))} current={href(view)} />
      )}

      <TeamBoard
        id="scored"
        title="Points per game"
        rows={boards.scored}
        team={team}
        figure={oneDecimal}
        unit="points per game"
        empty={`No team has ${min} games yet.`}
      />
      <TeamBoard
        id="allowed"
        title="Fewest points allowed per game"
        rows={boards.allowed}
        team={team}
        figure={oneDecimal}
        unit="points allowed per game"
        empty={`No team has ${min} games yet.`}
      />
      <TeamBoard
        id="margin"
        title="Average margin"
        note="Points scored minus points allowed, per game."
        rows={boards.margin}
        team={team}
        figure={signedDecimal}
        unit="points per game ahead"
        empty={`No team has ${min} games yet.`}
      />
      <TeamBoard
        id="shutouts"
        title="Shutouts"
        note="Games in which the other team scored no points."
        rows={boards.shutouts}
        team={team}
        figure={String}
        unit="shutouts"
        empty="No shutouts yet."
      />
      <TeamBoard
        id="mercy"
        title={`Wins by ${MERCY_MARGIN} or more`}
        note={`Games a team led by ${MERCY_MARGIN} points or more at the end, where the 45-point rule stops the game.`}
        rows={boards.mercy}
        team={team}
        figure={String}
        unit={`wins by ${MERCY_MARGIN} or more`}
        empty="None yet."
      />
      <TeamBoard
        id="sixty"
        title={`${HIGH_SCORE}-point games`}
        note={`Games in which the team scored ${HIGH_SCORE} points or more.`}
        rows={boards.sixty}
        team={team}
        figure={String}
        unit={`games of ${HIGH_SCORE} points or more`}
        empty="None yet."
      />
      <GameBoard rows={boards.singles} team={team} />
      <TeamBoard
        id="season-allowed"
        title="Fewest points allowed, season"
        note={`The season's total, teams with at least ${SEASON_MIN_GAMES} games.`}
        rows={boards.seasonAllowed}
        team={team}
        figure={String}
        unit="points allowed in the season"
        empty={`No team has ${SEASON_MIN_GAMES} games yet.`}
      />
    </section>
  );
}
