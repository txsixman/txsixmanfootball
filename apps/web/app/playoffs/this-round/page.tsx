import type { Metadata } from "next";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { loadAlignments } from "@/lib/alignments";
import { bracketHref, bracketLabel, LEAGUES, loadBrackets } from "@/lib/brackets";
import { loadIdentities } from "@/lib/identity";
import { centralClock, currentRound } from "@/lib/playoff-status";
import { CURRENT_SEASON } from "@/lib/season";
import { PageHeader, SectionBar } from "../../ui";
import { GameList } from "../game-list";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Playoffs this round",
  description: `Every Texas six-man playoff game of the round being played, ${CURRENT_SEASON}: each organization and division, with date, site, status and projection.`,
  alternates: { canonical: "/playoffs/this-round" },
};

/**
 * The round being played in every bracket, on one page: organization, then division. Each bracket shows the round its
 * own page opens on (lib/playoff-status.ts currentRound), so a bracket a round ahead or behind shows its own round.
 * Built from the brackets and their kickoff times (ADR 0036): date, kickoff, site, status and projection. A
 * robot-read score is unconfirmed and names no winner (ADR 0004). The site is static: "as of" is the time of this build.
 */
export default async function ThisRoundPage() {
  const [brackets, alignments, identities] = await Promise.all([loadBrackets(), loadAlignments(), loadIdentities()]);
  const clock = centralClock();
  const groups = LEAGUES.map((league) => ({
    league,
    brackets: brackets.flatMap((b) => {
      const round = b.league === league ? currentRound(b.rounds, clock.date) : undefined;
      return round ? [{ bracket: b, round }] : [];
    }),
  })).filter((g) => g.brackets.length);
  const games = groups.reduce((n, g) => n + g.brackets.reduce((m, b) => m + b.round.games.length, 0), 0);

  return (
    <section aria-labelledby="this-round">
      <PageHeader id="this-round" eyebrow={`${CURRENT_SEASON} season · ${games} ${games === 1 ? "game" : "games"}`} title="Playoffs this round" />
      <div className="mt-4 border-2 border-navy bg-panel px-3 py-2">
        <p className="font-num text-[22px] font-bold uppercase leading-tight tracking-wide text-navy">Scores as of {clock.label}</p>
        <p className="mt-1 text-[14px] leading-5 text-ink">
          Each bracket&rsquo;s current round. Kickoff times are Central, and each game&rsquo;s status is as of when you opened this page. Scores may be corrected if a mistake is found.
        </p>
      </div>
      {groups.length === 0 ? (
        <p className="mt-6 text-[16px] text-ink">No {CURRENT_SEASON} playoff brackets yet.</p>
      ) : (
        <>
          {groups.length > 1 && (
            <nav aria-label="Organizations" className="mt-3 flex flex-wrap border-b border-line px-1">
              {groups.map((g) => (
                <a key={g.league} href={`#org-${g.league.toLowerCase()}`} className="inline-flex min-h-11 items-center px-2 font-num text-[17px] font-bold uppercase tracking-wide text-navy underline-offset-4 hover:underline">
                  {g.league}
                </a>
              ))}
            </nav>
          )}
          {groups.map((g) => (
            <section key={g.league} aria-labelledby={`org-${g.league.toLowerCase()}`} className="mt-8">
              <SectionBar id={`org-${g.league.toLowerCase()}`} title={g.league} className="" />
              {g.brackets.map(({ bracket: b, round }) => (
                <section key={b.name} aria-label={`${b.name}, ${round.label}`} className="mt-4">
                  <h3 className="border-b-2 border-navy px-3 pb-1 font-num text-[20px] font-bold uppercase tracking-wider text-navy">
                    {bracketLabel(b)} · {round.label}{" "}
                    <span className="font-sans text-[13px] font-normal normal-case tracking-normal text-muted">
                      · {round.games.length} {round.games.length === 1 ? "game" : "games"}
                    </span>
                  </h3>
                  <GameList games={round.games} league={b.league} alignments={alignments} identities={identities} today={clock.date} />
                  <Link href={bracketHref(b.name)} className="flex min-h-11 items-center justify-between border-b border-line px-3 text-[14px] font-semibold text-navy hover:bg-panel">
                    Full {bracketLabel(b)} bracket
                    <ChevronRight aria-hidden="true" className="size-5 shrink-0" />
                  </Link>
                </section>
              ))}
            </section>
          ))}
        </>
      )}
      <p className="mt-6 text-[13px] text-muted">
        Away team first. Projections use the current ratings, on a neutral field unless the game is at a home site.
      </p>
    </section>
  );
}
