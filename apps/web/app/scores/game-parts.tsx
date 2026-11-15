import { Check, CircleHelp, TriangleAlert } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import type { Identity } from "@/lib/identity";
import type { Game, Team } from "@/lib/demo-games";
import { isForfeit, leaderOf, winnerOf, type Side } from "@/lib/score-display";
import { Crest } from "../programs/crest";
import { ForfeitMark, scoreClass } from "./parts";

// The parts both kinds of game page share: a playoff or sample game (scores/[id]) and a robot-read result.

function Monogram({ team }: { team: Team }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex size-10 shrink-0 items-center justify-center font-num text-[16px] font-bold leading-none tracking-wide text-white"
      style={{ backgroundColor: team.color }}
    >
      {team.initials}
    </span>
  );
}

/** A real school's page and look, when the team is a known program; the invented sample schools have neither. */
export type Program = { slug: string; identity: Identity };

/** `neutral`: the site was neutral or not listed, so neither team is called home or away. */
export function BigLine({ g, side, program, neutral }: { g: Game; side: Side; program?: Program; neutral?: boolean }) {
  const team = g[side];
  const score = side === "home" ? g.homeScore : g.awayScore;
  const winner = winnerOf(g);
  const lost = winner !== null && winner !== side;
  const leads = leaderOf(g) === side;
  return (
    <div className="flex items-center gap-3 border-b border-line py-3">
      {program ? <Crest school={team.name} identity={program.identity} size={44} decorative /> : <Monogram team={team} />}
      <div className="min-w-0 flex-1">
        <p className={`font-num text-[28px] font-bold uppercase leading-none tracking-wide ${lost ? "text-ink/70" : "text-ink"}`}>
          {team.rank != null && <span className="mr-1.5 text-[18px] text-navy">#{team.rank}</span>}
          {program ? (
            <Link href={`/programs/${program.slug}`} className="name-link">
              {team.name}
            </Link>
          ) : (
            team.name
          )}
        </p>
        <p className="text-[13px] text-muted">
          {[team.mascot || program?.identity.mascot, team.record, neutral ? undefined : side === "home" ? "Home" : "Away"].filter(Boolean).join(" · ")}
        </p>
      </div>
      {isForfeit(g) && winner ? (
        <ForfeitMark side={side} winner={winner} large />
      ) : score == null || isForfeit(g) ? (
        <p className="min-w-[92px] px-2 text-center font-num text-[72px] font-semibold leading-none text-muted">
          <span aria-hidden="true">&ndash;</span>
          <span className="sr-only">no score</span>
        </p>
      ) : leads ? (
        <p className="min-w-[92px] bg-band px-2 py-1 text-center font-num text-[72px] font-bold leading-[0.95] text-white">
          {score}
          <span className="sr-only">{winner ? " winner" : " leading"}</span>
        </p>
      ) : (
        <p className={`min-w-[92px] px-2 text-center font-num text-[72px] leading-[0.95] ${scoreClass(g, lost)}`}>{score}</p>
      )}
    </div>
  );
}

export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-x-3 border-b border-line py-2.5">
      <dt className="pt-0.5 text-[13px] font-bold uppercase tracking-wider text-muted">{label}</dt>
      <dd className="text-[15px] leading-5 text-ink">{children}</dd>
    </div>
  );
}

export function Verification({ g }: { g: Game }) {
  const icon = "mt-0.5 size-4 shrink-0";
  if (g.verification === "confirmed") {
    return (
      <span className="flex items-start gap-1.5">
        <Check aria-hidden="true" className={`${icon} text-navy`} strokeWidth={3} />
        <span><b>Confirmed.</b>{g.sources ? ` ${g.sources}.` : ""}</span>
      </span>
    );
  }
  if (g.verification === "unconfirmed") {
    return (
      <span className="flex items-start gap-1.5">
        <CircleHelp aria-hidden="true" className={`${icon} text-red`} strokeWidth={2.5} />
        <span><b>Unconfirmed.</b>{g.sources ? ` ${g.sources}.` : ""} The score may change.</span>
      </span>
    );
  }
  return (
    <span className="flex items-start gap-1.5">
      <TriangleAlert aria-hidden="true" className={`${icon} text-red`} strokeWidth={2.5} />
      <span><b>Disputed.</b>{g.sources ? ` ${g.sources}.` : ""} No winner is marked.</span>
    </span>
  );
}

