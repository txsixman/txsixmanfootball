"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { Game } from "@/lib/demo-games";
import { asLive, liveStatus, liveView, type LiveRow, type LiveView } from "@/lib/live-scores";
import { BigLine, type Program } from "./game-parts";
import { KickoffStatus } from "../kickoff-status";
import { useLiveScores } from "./live-score";

// A game under way shows its live score where its score goes, not beside it (ADR 0021): the read's score, dashed and
// "Unconfirmed", naming no winner or leader, with where it stands ("Q3 · 4:12 left · as of 7:42 PM CT"). A final replaces it.

/** "Live · Q3 · 4:12 left · as of 7:42 PM CT · Unconfirmed" (`score`, when given, after "Live"; with no period, "Live" once).
 * A game the read saw finished: "Score reported · 28-14 · as of 9:05 PM CT · Unconfirmed" (ADR 0042). */
const statusLine = (live: LiveView, score?: string) =>
  live.finished
    ? ["Score reported", score, liveStatus(live).replace(/^Score reported · /, ""), "Unconfirmed"].filter(Boolean).join(" · ")
    : ["Live", score, liveStatus(live).replace(/^Live · /, ""), "Unconfirmed"].filter(Boolean).join(" · ");

const GameLiveRows = createContext<LiveRow[]>([]);

/** A game page's one live read, shared by its header (GameKickoffStatus) and its score (GameScore): asked only while a game
 * with no final (`watch`) may be under way (useLiveScores). */
export function GameLiveRead({ date, kickoff, watch, children }: { date?: string; kickoff?: string; watch: boolean; children: ReactNode }) {
  return <GameLiveRows.Provider value={useLiveScores(watch && date ? [{ date, kickoff }] : [])}>{children}</GameLiveRows.Provider>;
}

/** The game page header's kickoff status (ADR 0036), except for a game the live read saw finished: "Score reported", never
 * "In progress" (ADR 0042). */
export function GameKickoffStatus({ g }: { g: Game & { date: string } }) {
  const live = liveView(useContext(GameLiveRows), { date: g.date, home: g.home.name, away: g.away.name });
  if (live?.finished) return <span data-kickoff-status="reported">Score reported</span>;
  return <KickoffStatus date={g.date} kickoff={g.kickoff} tone={false} />;
}

/** The game page's score: the two big lines. While a game with no final is under way (`watch`), they hold the live score,
 * under a line saying where it stands; otherwise they are the page's own. Reads the page's one live read (GameLiveRead). */
export function GameScore({ g, away, home, neutral, watch }: { g: Game; away?: Program; home?: Program; neutral?: boolean; watch: boolean }) {
  const rows = useContext(GameLiveRows);
  const live = watch ? liveView(rows, { date: g.date, home: g.home.name, away: g.away.name }) : null;
  const shown = live ? asLive(g, live) : g;
  return (
    <>
      {live && (
        <p data-live-score className="px-3 pt-2 font-num text-[15px] font-bold uppercase leading-5 tracking-wide text-red">
          {statusLine(live)}
        </p>
      )}
      <section aria-label="Score" className="px-3">
        <BigLine g={shown} side="away" program={away} neutral={neutral} />
        <BigLine g={shown} side="home" program={home} neutral={neutral} />
      </section>
    </>
  );
}

const ProgramLiveRows = createContext<LiveRow[]>([]);

/** A program page's one live read, for its next game (`date`, `kickoff`), shared by the next-game box and the game's row:
 * asked only from kickoff to the end of its window (useLiveScores), so a page with no game in progress asks for nothing. */
export function ProgramLiveRead({ date, kickoff, children }: { date: string; kickoff?: string; children: ReactNode }) {
  return <ProgramLiveRows.Provider value={useLiveScores([{ date, kickoff }])}>{children}</ProgramLiveRows.Provider>;
}

/** A program page's game with no score yet, while it is under way: the live score from `school`'s side ("28-14"), dashed,
 * from the page's one read (ProgramLiveRead). `line` shows it with where the game stands, for the next-game box; otherwise
 * it is the score alone, for a game row. Shows `children` (what the page has without it) when there is no live score. */
export function ProgramLiveScore({ date, school, opponent, home, line, children }: { date: string; school: string; opponent: string; home: boolean; line?: boolean; children?: ReactNode }) {
  const rows = useContext(ProgramLiveRows);
  const live = liveView(rows, { date, home: home ? school : opponent, away: home ? opponent : school });
  if (!live) return <>{children}</>;
  const [us, them] = home ? [live.home.score, live.away.score] : [live.away.score, live.home.score];
  const score = `${us}-${them}`;
  if (line) {
    return (
      <span data-live-score className="block font-num text-[15px] font-bold uppercase tracking-wide text-red">
        {statusLine(live, score)}
      </span>
    );
  }
  return (
    <span data-live-score className="underline decoration-dashed decoration-2 underline-offset-[5px]">
      {score}
      <span className="sr-only"> live, unconfirmed</span>
    </span>
  );
}
