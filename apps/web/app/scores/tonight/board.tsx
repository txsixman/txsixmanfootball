"use client";

import Link from "next/link";
import { liveView, type LiveRow } from "@/lib/live-scores";
import { nightOrder } from "@/lib/night-order";
import type { Night, NightGame } from "@/lib/tonight";
import { UnconfirmedMark } from "../../ui";
import { LiveLine, useLiveScores } from "../live-score";

// Tonight's games, one organization at a time and each round under it (ADR 0012). A game with no final yet may be under way,
// so its live line is read in the browser exactly as the scoreboard reads it (ADR 0021). Every score is the reader's:
// "Unconfirmed", and no team is named the winner or marked as leading.

const liveOf = (g: NightGame, liveRows: LiveRow[]) => (g.state === "later" ? liveView(liveRows, { date: g.date, home: g.home, away: g.away }) : null);

function Status({ g, liveRows }: { g: NightGame; liveRows: LiveRow[] }) {
  if (g.state === "forfeit") return <p className="text-[14px] font-bold leading-5 text-ink">Forfeit</p>;
  if (g.state === "final") {
    return (
      <>
        <p className="flex items-center gap-2 text-[14px] font-bold uppercase leading-5 tracking-wide text-navy">
          Final
          {g.unconfirmed && <UnconfirmedMark />}
        </p>
        <p className="text-[15px] leading-5 text-ink">
          {g.away} {g.awayScore}, {g.home} {g.homeScore}
        </p>
      </>
    );
  }
  const live = liveOf(g, liveRows);
  if (live) return <LiveLine live={live} />;
  return (
    <>
      <p className="text-[14px] font-semibold leading-5 text-ink">No score yet</p>
      {g.projected && <p className="text-[14px] leading-5 text-muted">Projected: {g.projected}</p>}
    </>
  );
}

export default function TonightBoard({ night }: { night: Night }) {
  // Only a game with no final can be under way: a night of finals asks for nothing.
  const liveRows = useLiveScores(night.orgs.some((o) => o.rounds.some((r) => r.games.some((g) => g.state === "later"))));
  return (
    <>
      {night.orgs.map((org) => (
        <section key={org.slug} aria-labelledby={`night-${org.slug}`}>
          <h2 id={`night-${org.slug}`} className="bg-navy px-3 py-1 font-num text-[20px] font-bold uppercase tracking-wider text-white">
            {org.label}
          </h2>
          {org.rounds.map((round) => (
            <div key={round.label}>
              <h3 className="border-b border-line bg-panel px-3 py-1 font-num text-[14px] font-bold uppercase tracking-wider text-navy">{round.label}</h3>
              <ul>
                {nightOrder(round.games, (g) => !!liveOf(g, liveRows)).map((g) => (
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
