"use client";

import Link from "next/link";
import { groupTonight } from "@/lib/kickoff";
import { checkedAt, liveView, type LiveRow, type LiveView } from "@/lib/live-scores";
import { projectedLine, type Outcome } from "@/lib/outcome";
import type { Night, NightGame } from "@/lib/tonight";
import { KickoffStatus, useNow } from "../../kickoff-status";
import { ScoresChecked } from "../freshness";
import { LiveLine, useLiveScores } from "../live-score";

// Tonight's games, one organization at a time (ADR 0012), each in groups by the clock: in progress, up next, final. A game
// with no final yet may be under way, so its live score is read in the browser as the scoreboard reads it (ADR 0021) and
// shown in place (ADR 0039): a game the read has a score for is In progress, its line "Unconfirmed" with no leader; one the
// read says is over is a Final with its score and when it was read (ADR 0043), until the stored final replaces it. Each
// game with a projection shows it beside the outcome (ADR 0044): the projection alone before kickoff, "Now: 14–28 ·
// Unconfirmed" under way (no leader), "Final: <team> by 3" after, or the word for a disputed final or a forfeit.

/** A game as Tonight shows it: with the live read's score in place (ADR 0039). A game under way is in progress whatever its
 * kickoff says; one the read says is over (ADR 0043) is a final, with its score and when it was read, until the stored
 * final replaces it. */
type TonightGame = NightGame & { round: string; underWay?: boolean; asOf?: string };
function withLive(g: NightGame & { round: string }, liveRows: LiveRow[]): TonightGame {
  if (g.state !== "later") return g;
  const live = liveView(liveRows, { date: g.date, home: g.home, away: g.away });
  if (!live) return g;
  if (!live.finished) return { ...g, underWay: true };
  return { ...g, state: "final", awayScore: live.away.score, homeScore: live.home.score, unconfirmed: false, asOf: checkedAt(live.readAt) };
}

/** The game's outcome so far in lib/outcome.ts terms: under way from the live read, else its own state. On this page an
 * "unconfirmed" final is a disputed one (lib/tonight.ts), so its line names no winner. */
function outcome(g: TonightGame, live: LiveView | null): Outcome {
  const teams = { home: g.home, away: g.away };
  if (live) return { ...teams, homeScore: live.home.score, awayScore: live.away.score, state: "live" };
  if (g.state === "later") return { ...teams, state: "scheduled" };
  return { ...teams, homeScore: g.homeScore, awayScore: g.awayScore, state: "final", forfeit: g.state === "forfeit", disputed: g.unconfirmed };
}

/** "Projected: Jayton by 7 · 74% chance to win · Final: Guthrie by 3", or nothing for a game with no projection. */
function Projected({ g, live }: { g: TonightGame; live: LiveView | null }) {
  const line = projectedLine(g.projected, outcome(g, live));
  return line ? <p data-projected className="text-[14px] leading-5 text-muted">{line}</p> : null;
}

function Status({ g, liveRows }: { g: TonightGame; liveRows: LiveRow[] }) {
  if (g.state === "forfeit") {
    return (
      <>
        <p className="text-[14px] font-bold leading-5 text-ink">Forfeit</p>
        <Projected g={g} live={null} />
      </>
    );
  }
  if (g.state === "final") {
    return (
      <>
        <p className="text-[14px] font-bold uppercase leading-5 tracking-wide text-navy">{g.unconfirmed ? "Score reported" : "Final"}</p>
        <p className="text-[15px] leading-5 text-ink">
          {g.away} {g.awayScore}, {g.home} {g.homeScore}
          {g.unconfirmed && <span className="text-muted"> &middot; disputed</span>}
          {g.asOf && <span className="text-muted"> &middot; as of {g.asOf}</span>}
        </p>
        <Projected g={g} live={null} />
      </>
    );
  }
  const live = liveView(liveRows, { date: g.date, home: g.home, away: g.away });
  if (live) {
    return (
      <>
        <LiveLine live={live} />
        <Projected g={g} live={live} />
      </>
    );
  }
  return (
    <>
      <p className="text-[14px] font-bold uppercase leading-5 tracking-wide text-navy">
        <KickoffStatus date={g.date} kickoff={g.kickoff} />
      </p>
      <Projected g={g} live={null} />
    </>
  );
}

export default function TonightBoard({ night }: { night: Night }) {
  // Only a game with no final can be under way, and only inside its window (lib/kickoff.ts anyInProgress): a night of
  // finals, or the hours before the first kickoff, ask for nothing.
  const liveRows = useLiveScores(night.orgs.flatMap((o) => o.rounds.flatMap((r) => r.games.filter((g) => g.state === "later"))));
  // The groups are worked out in the browser, as the status labels are, so this static page re-sorts as the clock moves.
  const now = useNow();
  return (
    <>
      <ScoresChecked games={night.orgs.flatMap((o) => o.rounds.flatMap((r) => r.games))} className="px-3 pt-2" />
      {night.orgs.map((org) => {
        // Each game keeps its round on its line, now that the groups replace the round headings.
        const games = org.rounds.flatMap((r) => r.games.map((g) => withLive({ ...g, round: r.label }, liveRows)));
        return (
          <section key={org.slug} aria-labelledby={`night-${org.slug}`}>
            <h2 id={`night-${org.slug}`} className="bg-navy px-3 py-1 font-num text-[20px] font-bold uppercase tracking-wider text-white">
              {org.label}
            </h2>
            {groupTonight(games, now).map((group) => (
              <div key={group.key} data-group={group.key}>
                <h3 className="border-b border-line bg-panel px-3 py-1 font-num text-[14px] font-bold uppercase tracking-wider text-navy">{group.label}</h3>
                <ul>
                  {group.games.map((g) => (
                    <li key={g.id} data-game={g.id} className="border-b border-line">
                      <Link href={g.href} className="block min-h-16 px-3 py-2 hover:bg-panel focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-navy active:bg-panel">
                        <p className="text-[16px] font-semibold leading-5 text-ink">
                          {g.away} vs {g.home}
                        </p>
                        <p className="text-[13px] leading-4 text-muted">{g.round === "Season games" ? g.where : `${g.where} \u00b7 ${g.round}`}</p>
                        <div className="mt-0.5">
                          <Status g={g} liveRows={liveRows} />
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        );
      })}
    </>
  );
}
