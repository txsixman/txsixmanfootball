import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { loadAlignments } from "@/lib/alignments";
import { playoffsDescription } from "@/lib/descriptions";
import { bracketHref, bracketLabel, latestRound, LEAGUES, loadBrackets, playoffLeagues, playoffSeasons } from "@/lib/brackets";
import { loadIdentities } from "@/lib/identity";
import { centralClock } from "@/lib/playoff-status";
import { TabNav } from "../tab-nav";
import { PageHeader, SectionBar } from "../ui";
import { ChanceList } from "./chance-list";
import { BuiltList, GameList } from "./game-list";

export type League = (typeof LEAGUES)[number];
/** The latest season lives at /playoffs; past seasons at /playoffs/season/<year> (UIL) and .../<league>. */
const leagueHref = (league: League, season?: number) => {
  const slug = league === "UIL" ? "" : `/${league.toLowerCase()}`;
  return season === undefined ? `/playoffs${slug}` : `/playoffs/season/${season}${slug}`;
};

/** The meta description of one league's playoffs: the latest season, or a past `season`. */
export async function describePlayoffs(league: League, season?: number) {
  const seasons = await playoffSeasons();
  const year = season ?? seasons[0];
  const brackets = (await loadBrackets(year)).filter((b) => b.league === league).length;
  return playoffsDescription({ league, season: year, brackets, past: year !== seasons[0] });
}

/** One league's playoff brackets for a season (the latest by default), round by round. Robot-read scores are unconfirmed, so no row names a winner (ADR 0004). */
export async function PlayoffsView({ league, season }: { league: League; season?: number }) {
  const seasons = await playoffSeasons();
  const year = season ?? seasons[0];
  const past = year !== seasons[0];
  const [all, alignments, identities, leagues, perSeason] = await Promise.all([
    loadBrackets(year),
    loadAlignments(),
    loadIdentities(),
    playoffLeagues(year),
    Promise.all(seasons.map(playoffLeagues)),
  ]);
  const brackets = all.filter((b) => b.league === league);
  const { date: today } = centralClock();
  // A season tab keeps the league you are on when that season has it, else opens on UIL.
  const seasonTabs = seasons.map((s, i) => ({
    href: leagueHref(perSeason[i].includes(league) ? league : "UIL", s === seasons[0] ? undefined : s),
    label: String(s),
  }));

  return (
    <section aria-labelledby="playoffs">
      <PageHeader id="playoffs" eyebrow={`${year} season · ${brackets.length} ${brackets.length === 1 ? "bracket" : "brackets"}`} title="Playoffs" />
      {seasons.length > 1 && <TabNav label="Season" wrap tabs={seasonTabs} current={seasonTabs[seasons.indexOf(year)].href} />}
      <TabNav label="League" tabs={leagues.map((l) => ({ href: leagueHref(l, past ? year : undefined), label: l }))} current={leagueHref(league, past ? year : undefined)} />
      {!past && (
        <Link href="/playoffs/this-round" className="mt-3 flex min-h-11 items-center justify-between border-2 border-navy px-3 font-num text-[17px] font-bold uppercase tracking-wide text-navy hover:bg-panel">
          This round in every bracket
          <ChevronRight aria-hidden="true" className="size-5 shrink-0" />
        </Link>
      )}
      {brackets.map((b) => {
        const id = `bracket-${b.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
        const roundId = (round: string) => `${id}-${round}`;
        return (
          <section key={b.name} aria-labelledby={id} className="mt-8">
            <SectionBar id={id} title={b.name} aside={`Latest: ${latestRound(b)!.label}`} className="" />
            {!past && (
              <Link href={bracketHref(b.name)} className="flex min-h-11 items-center justify-between border-b border-line px-3 font-num text-[16px] font-bold uppercase tracking-wide text-navy hover:bg-panel">
                {bracketLabel(b)} bracket page: current round first
                <ChevronRight aria-hidden="true" className="size-5 shrink-0" />
              </Link>
            )}
            {b.rounds.length > 1 && (
              // Rounds run earliest first, so the latest is far down a phone: one tap gets to any of them.
              <nav aria-label={`${b.name} rounds`} className="flex flex-wrap border-b border-line px-1">
                {b.rounds.map((r) => (
                  <a key={r.round} href={`#${roundId(r.round)}`} className="inline-flex min-h-11 items-center px-2 font-num text-[16px] font-bold uppercase tracking-wide text-navy underline-offset-4 hover:underline">
                    {r.label}
                  </a>
                ))}
              </nav>
            )}
            {(b.chances || b.regionChances?.length) && (
              <div className="grid gap-x-8 gap-y-5 border-b border-line px-3 py-4 sm:grid-cols-2">
                {b.chances && <ChanceList id={`${id}-chances`} title="State title chances" chances={b.chances} identities={identities} />}
                {b.regionChances?.map((r) => (
                  <ChanceList key={r.region} id={`${id}-region-${r.region}`} title={`Region ${r.region} · region title chances`} chances={r.chances} identities={identities} />
                ))}
              </div>
            )}
            {b.rounds.map((r) => (
              <section key={r.round} id={roundId(r.round)} aria-label={`${b.name}, ${r.label}`} className="mt-5 scroll-mt-4">
                <h3 className="border-b-2 border-navy px-3 pb-1 font-num text-[20px] font-bold uppercase tracking-wider text-navy">
                  {r.label}{" "}
                  <span className="font-sans text-[13px] font-normal normal-case tracking-normal text-muted">
                    · {r.games.length} {r.games.length === 1 ? "game" : "games"}
                    {r.built.length ? ` · ${r.built.length} more set by the bracket` : ""}
                  </span>
                </h3>
                {r.games.length > 0 && <GameList games={r.games} league={league} alignments={alignments} identities={identities} today={today} showStatus={!past} />}
                {r.built.length > 0 && <BuiltList games={r.built} league={league} alignments={alignments} identities={identities} />}
              </section>
            ))}
          </section>
        );
      })}
      <p className="mt-6 text-[13px] text-muted">
        Away team first. Scores may be corrected if a mistake is found. A team&rsquo;s next game shows who went on.
        {!past && " Projections and region and state title chances use the current ratings, on a neutral field unless the game is at a home site. A region\u2019s chances show once its two area games or its regional game are set."}
      </p>
    </section>
  );
}
