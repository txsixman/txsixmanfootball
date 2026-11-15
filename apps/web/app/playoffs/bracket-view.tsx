import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { loadAlignments } from "@/lib/alignments";
import { bracketHref, bracketLabel, type Bracket, latestRound, roundLabel } from "@/lib/brackets";
import { loadIdentities } from "@/lib/identity";
import { bracketIntro } from "@/lib/intros";
import { breadcrumbList } from "@/lib/json-ld";
import { previewOf } from "@/lib/playoff-path";
import { centralClock, currentRound } from "@/lib/playoff-status";
import { chanceText, projectionParts } from "@/lib/projection";
import { loadRatings } from "@/lib/ratings";
import { CURRENT_SEASON } from "@/lib/season";
import { JsonLd } from "../json-ld";
import { TabNav } from "../tab-nav";
import { PageHeader } from "../ui";
import { ChanceList } from "./chance-list";
import { BuiltList, GameList } from "./game-list";

const leagueHref = (league: string) => (league === "UIL" ? "/playoffs" : `/playoffs/${league.toLowerCase()}`);

/**
 * One bracket on its own page: the round being played first, every game's status (not yet played, tonight, score
 * reported, forfeit), projections for games not yet played and for the next pairing. The site is static: this page is
 * rebuilt when the results robot commits new scores, so "scores as of" is the time of that build. A robot-read score is
 * unconfirmed and names no winner (ADR 0004); a bracket may go on from one (ADR 0013).
 */
export async function BracketView({ bracket: b, siblings }: { bracket: Bracket; siblings: Bracket[] }) {
  const [alignments, identities, table] = await Promise.all([loadAlignments(), loadIdentities(), loadRatings(CURRENT_SEASON)]);
  const clock = centralClock();
  const current = currentRound(b.rounds, clock.date);
  const rounds = [...(current ? [current] : []), ...b.rounds.filter((r) => r !== current)];
  const previews = b.pairs.flatMap((pair) => {
    const preview = previewOf(table, pair);
    return preview ? [{ pair, ...preview }] : [];
  });
  const roundId = (round: string) => `round-${round}`;

  return (
    <section aria-labelledby="bracket">
      <nav aria-label="Back" className="-mx-1">
        <Link href={leagueHref(b.league)} className="inline-flex min-h-11 items-center gap-1.5 px-1 text-[14px] font-semibold text-navy">
          <ArrowLeft aria-hidden="true" className="size-4" strokeWidth={2.5} />
          All {b.league} playoffs
        </Link>
      </nav>
      {/* The back link is the trail on screen; search engines get the same trail as markup. */}
      <JsonLd data={breadcrumbList([{ name: "Home", href: "/" }, { name: `${b.league} playoffs`, href: leagueHref(b.league) }, { name: b.name, href: bracketHref(b.name) }])} />
      <PageHeader id="bracket" size="md" eyebrow={`${CURRENT_SEASON} season · ${b.league} · latest: ${latestRound(b)!.label}`} title={b.name} note={bracketIntro({ name: b.name, season: CURRENT_SEASON })} />
      {siblings.length > 1 && (
        <TabNav label={`${b.league} brackets`} tabs={siblings.map((s) => ({ href: bracketHref(s.name), label: bracketLabel(s) }))} current={bracketHref(b.name)} wrap />
      )}

      <div className="mt-4 border-2 border-navy bg-panel px-3 py-2">
        <p className="font-num text-[22px] font-bold uppercase leading-tight tracking-wide text-navy">Scores as of {clock.label}</p>
        <p className="mt-1 text-[14px] leading-5 text-ink">
          This page is rebuilt with the newest scores read, about every 30 minutes on playoff Friday nights. Scores may be corrected if a mistake is found.
        </p>
      </div>

      {b.rounds.length > 1 && (
        <nav aria-label={`${b.name} rounds`} className="mt-3 flex flex-wrap border-b border-line px-1">
          {b.rounds.map((r) => (
            <a
              key={r.round}
              href={`#${roundId(r.round)}`}
              aria-current={r === current ? "location" : undefined}
              className={`inline-flex min-h-11 items-center px-2 font-num text-[17px] font-bold uppercase tracking-wide underline-offset-4 hover:underline ${r === current ? "bg-navy text-white" : "text-navy"}`}
            >
              {r.label}
            </a>
          ))}
        </nav>
      )}

      {(b.chances || b.regionChances?.length) && (
        <div className="grid gap-x-8 gap-y-5 border-b border-line px-3 py-4 sm:grid-cols-2">
          <h2 className="sr-only">Title chances</h2>
          {b.chances && <ChanceList id="chances" title="State title chances" chances={b.chances} identities={identities} />}
          {b.regionChances?.map((r) => (
            <ChanceList key={r.region} id={`region-${r.region}`} title={`Region ${r.region} · region title chances`} chances={r.chances} identities={identities} />
          ))}
        </div>
      )}

      {previews.length > 0 && (
        <section aria-labelledby="pairings" className="mt-5">
          <h2 id="pairings" className="border-b-2 border-navy px-3 pb-1 font-num text-[20px] font-bold uppercase tracking-wider text-navy">
            Likely next pairings
          </h2>
          <ul className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
            {previews.map(({ pair, sides, projection }) => {
              const { margin, chance } = projectionParts(projection);
              return (
                <li key={pair.games[0].home} className="min-w-0 border-b border-line px-3 py-2 text-[16px] text-ink">
                  <p className="font-num text-[16px] font-bold uppercase tracking-wide text-muted">
                    {roundLabel(pair.next, b.league)}
                    {pair.region ? ` · Region ${pair.region}` : ""}
                  </p>
                  <p className="text-[20px] font-bold leading-tight">
                    {sides[0].team} vs {sides[1].team}
                  </p>
                  <p className="font-semibold text-navy">
                    <span>Projected: {margin}</span> · <span className="whitespace-nowrap">{chance}</span>
                  </p>
                  <p className="text-[14px] leading-5 text-muted">
                    If the higher-rated team wins each game of the pair: {sides[0].team} {chanceText(sides[0].reach)} to get there, {sides[1].team} {chanceText(sides[1].reach)}.
                  </p>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {rounds.map((r) => (
        <section key={r.round} id={roundId(r.round)} aria-label={`${b.name}, ${r.label}`} className="mt-5 scroll-mt-4">
          <h2 className="border-b-2 border-navy px-3 pb-1 font-num text-[22px] font-bold uppercase tracking-wider text-navy">
            {r.label}{" "}
            <span className="font-sans text-[13px] font-normal normal-case tracking-normal text-muted">
              · {r.games.length} {r.games.length === 1 ? "game" : "games"}
              {r.built.length ? ` · ${r.built.length} more set by the bracket` : ""}
              {r === current ? " · current round" : ""}
            </span>
          </h2>
          {r.games.length > 0 && <GameList games={r.games} league={b.league} alignments={alignments} identities={identities} today={clock.date} />}
          {r.built.length > 0 && <BuiltList games={r.built} league={b.league} alignments={alignments} identities={identities} />}
        </section>
      ))}

      <p className="mt-6 text-[13px] text-muted">
        Away team first. Projections and title chances use the current ratings, on a neutral field unless the game is at a home site. A team&rsquo;s next game shows who went on.
      </p>
    </section>
  );
}
