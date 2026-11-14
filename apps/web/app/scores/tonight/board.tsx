"use client";

import Link from "next/link";
import { groupTonight } from "@/lib/kickoff";
import { liveView, type LiveRow } from "@/lib/live-scores";
import type { Night, NightGame } from "@/lib/tonight";
import { KickoffStatus, useNow } from "../../kickoff-status";
import { LiveLine, useLiveScores } from "../live-score";

// Tonight's games, one organization at a time (ADR 0012), each in groups by the clock: in progress, up next, final. A game with no final yet may be under way,
// so its live line is read in the browser exactly as the scoreboard reads it (ADR 0021). Every score is the reader's:
// "Unconfirmed", and no team is named the winner or marked as leading.

function Status({ g, liveRows }: { g: NightGame; liveRows: LiveRow[] }) {
  if (g.state === "forfeit") return <p className="text-[14px] font-bold leading-5 text-ink">Forfeit</p>;
  if (g.state === "final") {
    return (
      <>
        <p className="text-[14px] font-bold uppercase leading-5 tracking-wide text-navy">{g.unconfirmed ? "Final · Unconfirmed" : "Final"}</p>
        <p className="text-[15px] leading-5 text-ink">
          {g.away} {g.awayScore}, {g.home} {g.homeScore}
          {g.unconfirmed && <span className="text-muted"> &middot; may change</span>}
        </p>
      </>
    );
  }
  const live = liveView(liveRows, { date: g.date, home: g.home, away: g.away });
  if (live) return <LiveLine live={live} />;
  return (
    <>
      <p className="text-[14px] font-bold uppercase leading-5 tracking-wide text-navy">
        <KickoffStatus date={g.date} kickoff={g.kickoff} />
      </p>
      {g.projected && <p className="text-[14px] leading-5 text-muted">Projected: {g.projected}</p>}
    </>
  );
}

export default function TonightBoard({ night }: { night: Night }) {
  // Only a game with no final can be under way, and only inside its kickoff window: a night of finals, or the hours before
  // the first kickoff, ask for nothing.
  const liveRows = useLiveScores(night.orgs.flatMap((o) => o.rounds.flatMap((r) => r.games.filter((g) => g.state === "later"))));
  // The groups are worked out in the browser, as the status labels are, so this static page re-sorts as the clock moves.
  const now = useNow();
  return (
    <>
      {night.orgs.map((org) => {
        // Each game keeps its round on its line, now that the groups replace the round headings.
        const games = org.rounds.flatMap((r) => r.games.map((g) => ({ ...g, round: r.label })));
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
                          {g.away} at {g.home}
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
