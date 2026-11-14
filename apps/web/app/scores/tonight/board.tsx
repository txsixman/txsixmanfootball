"use client";

import Link from "next/link";
import { liveView, type LiveRow } from "@/lib/live-scores";
import type { Night, NightGame } from "@/lib/tonight";
import { KickoffStatus } from "../../kickoff-status";
import { ScoresChecked } from "../freshness";
import { LiveLine, useLiveScores } from "../live-score";

// Tonight's games, one organization at a time and each round under it (ADR 0012). A game with no final yet may be under way,
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
  // Only a game with no final can be under way: a night of finals asks for nothing.
  const liveRows = useLiveScores(night.orgs.some((o) => o.rounds.some((r) => r.games.some((g) => g.state === "later"))));
  return (
    <>
      <ScoresChecked games={night.orgs.flatMap((o) => o.rounds.flatMap((r) => r.games))} className="px-3 pt-2" />
      {night.orgs.map((org) => (
        <section key={org.slug} aria-labelledby={`night-${org.slug}`}>
          <h2 id={`night-${org.slug}`} className="bg-navy px-3 py-1 font-num text-[20px] font-bold uppercase tracking-wider text-white">
            {org.label}
          </h2>
          {org.rounds.map((round) => (
            <div key={round.label}>
              <h3 className="border-b border-line bg-panel px-3 py-1 font-num text-[14px] font-bold uppercase tracking-wider text-navy">{round.label}</h3>
              <ul>
                {round.games.map((g) => (
                  <li key={g.id} data-game={g.id} className="border-b border-line">
                    <Link href={g.href} className="block min-h-16 px-3 py-2 hover:bg-panel focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-navy active:bg-panel">
                      <p className="text-[16px] font-semibold leading-5 text-ink">
                        {g.away} at {g.home}
                      </p>
                      <p className="text-[13px] leading-4 text-muted">{g.where}</p>
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
      ))}
    </>
  );
}
