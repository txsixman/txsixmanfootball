"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { Game } from "@/lib/demo-games";
import { pendingNote } from "@/lib/kickoff";
import { asLive, liveStatus, liveView, updatedAgo, type LiveRow, type LiveView } from "@/lib/live-scores";
import { projectedLine } from "@/lib/outcome";
import { outcomeOf } from "@/lib/score-display";
import { BigLine, type Program } from "./game-parts";
import { KickoffStatus, useNow } from "../kickoff-status";
import { useLiveScores } from "./live-score";

// A game under way shows its live score where its score goes, not beside it (ADR 0021): the read's score, dashed and
// "Unconfirmed", naming no winner or leader, with where it stands ("Q3 · 4:12 left · as of 7:42 PM CT"). Once the read
// says it is over it is a final (ADR 0043): "Final · as of 9:45 PM CT", the winner marked. The stored final replaces it.

/** "Live · Q3 · 4:12 left · as of 7:42 PM CT · Unconfirmed" (`score`, when given, after "Live"; with no period, "Live" once).
 * A finished game: "Final · 28-14 · as of 9:45 PM CT" (ADR 0043). */
const statusLine = (live: LiveView, score?: string) =>
  live.finished
    ? ["Final", score, liveStatus(live).replace(/^Final · /, "")].filter(Boolean).join(" · ")
    : ["Live", score, liveStatus(live).replace(/^Live · /, ""), "Unconfirmed"].filter(Boolean).join(" · ");

const GameLiveRows = createContext<LiveRow[]>([]);

/** A game page's one live read, shared by its header (GameKickoffStatus) and its score (GameScore): asked only while a game
 * with no final (`watch`) may be under way (useLiveScores). */
export function GameLiveRead({ date, kickoff, watch, children }: { date?: string; kickoff?: string; watch: boolean; children: ReactNode }) {
  return <GameLiveRows.Provider value={useLiveScores(watch && date ? [{ date, kickoff }] : [])}>{children}</GameLiveRows.Provider>;
}

/** The game page header's kickoff status (ADR 0036), except for a game the live read says is over: "Final", never
 * "In progress" (ADR 0043). */
function GameKickoffStatus({ g }: { g: Game & { date: string } }) {
  const live = liveView(useContext(GameLiveRows), { date: g.date, home: g.home.name, away: g.away.name });
  if (live?.finished) return <span data-kickoff-status="final">Final</span>;
  return <KickoffStatus date={g.date} kickoff={g.kickoff} tone={false} />;
}

/** The game page's top band (ADR 0087). A game the live read has a score for turns red and reads "Live" with how long ago the
 * score was read ("Updated 3 min ago", plus "may be behind" past two missed reads); a game not yet played says its kickoff
 * status as before (ADR 0036). The band is one line in every state, so a score arriving moves nothing. */
export function GameBand({ g, sample }: { g: Game; sample: boolean }) {
  const now = useNow();
  const rows = useContext(GameLiveRows);
  const watched = !sample && g.state === "scheduled" && !!g.date;
  const live = watched ? liveView(rows, { date: g.date, home: g.home.name, away: g.away.name }, now?.getTime()) : null;
  const underWay = g.state === "live" || (live !== null && !live.finished);
  return (
    <div className={`flex items-center justify-between gap-3 px-3 py-1.5 font-num text-[18px] font-bold uppercase tracking-wider text-white ${underWay ? "bg-alert" : "bg-band"}`}>
      <span>
        {underWay ? "Live" : g.status}
        {/* A real game not yet played: its kickoff status at the moment of viewing (ADR 0036). */}
        {!underWay && watched && (
          <>
            {" · "}
            <GameKickoffStatus g={{ ...g, date: g.date! }} />
          </>
        )}
      </span>
      {g.state === "live" && <span>{g.status}</span>}
      {live && !live.finished && (
        <span data-live-updated className="whitespace-nowrap text-[14px]">
          Updated {updatedAgo(live.readAt, now?.getTime() ?? Date.now())}
          {live.stale && " · may be behind"}
        </span>
      )}
    </div>
  );
}

/** The game page's score: the two big lines. While a game with no final is under way (`watch`), they hold the live score,
 * under a line saying where it stands; otherwise they are the page's own. Reads the page's one live read (GameLiveRead).
 * A game that may be under way holds a place for that line from the first paint (never blank: not started, in progress with
 * no score yet, or no score reported), so the score arriving, or leaving, moves nothing (ADR 0087). */
export function GameScore({ g, away, home, neutral, watch }: { g: Game; away?: Program; home?: Program; neutral?: boolean; watch: boolean }) {
  const rows = useContext(GameLiveRows);
  const now = useNow();
  const live = watch ? liveView(rows, { date: g.date, home: g.home.name, away: g.away.name }, now?.getTime()) : null;
  const shown = live ? asLive(g, live) : g;
  const note = watch && g.date && !live ? pendingNote({ date: g.date, kickoff: g.kickoff }, now) : null;
  return (
    <>
      {watch && (
        <div aria-live="polite" className="min-h-[3.75rem]">
          {live && (
            <p data-live-score className="px-3 pt-2 font-num text-[15px] font-bold uppercase leading-5 tracking-wide text-red">
              {statusLine(live)}
            </p>
          )}
          {note && (
            <div data-score-note className="px-3 pt-2">
              <p className="font-num text-[15px] font-bold uppercase leading-5 tracking-wide text-ink">{note.title}</p>
              <p className="text-[13px] leading-4 text-muted">{note.detail}</p>
            </div>
          )}
        </div>
      )}
      <section aria-label="Score" className="px-3">
        <BigLine g={shown} side="away" program={away} neutral={neutral} />
        <BigLine g={shown} side="home" program={home} neutral={neutral} />
      </section>
      {/* Under way: what was projected beside the score so far, naming no leader (ADR 0044). The place is held either way: until
          a score arrives, the same line is drawn hidden with stand-in digits, so it takes exactly the lines it will (it wraps
          to two or three on a phone) and the page below never moves. */}
      {watch && shown.projected && (
        <div className="px-3 pt-1">
          {live ? (
            <p data-projected className="text-[13px] leading-4 text-muted">
              {projectedLine(shown.projected, outcomeOf(shown))}
            </p>
          ) : (
            <p aria-hidden="true" className="invisible text-[13px] leading-4">
              {projectedLine(g.projected, outcomeOf({ ...g, state: "live", homeScore: 88, awayScore: 88, verification: "unconfirmed" }))}
            </p>
          )}
        </div>
      )}
    </>
  );
}

const ProgramLiveRows = createContext<LiveRow[]>([]);

/** A program page's one live read, for its next game (`date`, `kickoff`), shared by the next-game box and the game's row:
 * asked only from kickoff to the end of its window (useLiveScores), so a page with no game in progress asks for nothing. */
export function ProgramLiveRead({ date, kickoff, children }: { date: string; kickoff?: string; children: ReactNode }) {
  return <LiveRead games={[{ date, kickoff }]}>{children}</LiveRead>;
}

/** One live read for several games with no score yet (the home page's My teams next games), for ProgramLiveScore. */
export function LiveRead({ games, children }: { games: { date: string; kickoff?: string }[]; children: ReactNode }) {
  return <ProgramLiveRows.Provider value={useLiveScores(games)}>{children}</ProgramLiveRows.Provider>;
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
  // A finished game's score is a final (ADR 0043): solid, not dashed.
  if (live.finished) {
    return (
      <span data-live-score>
        {score}
        <span className="sr-only"> final</span>
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
