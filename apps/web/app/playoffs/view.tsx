import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { loadAlignments } from "@/lib/alignments";
import { playoffsDescription } from "@/lib/descriptions";
import { bracketHref, bracketLabel, latestRound, LEAGUES, loadBrackets, playoffLeagues, playoffSeasons } from "@/lib/brackets";
import { loadIdentities } from "@/lib/identity";
import { playoffsIntro } from "@/lib/intros";
import { rankedList } from "@/lib/json-ld";
import { centralClock, currentRound } from "@/lib/playoff-status";
import { whosLeft } from "@/lib/whos-left";
import { stateChampionships } from "@/lib/state-championships";
import { roundCount } from "@/lib/this-round";
import { JsonLd } from "../json-ld";
import { StateChampionshipLink } from "../championships/shared";
import { TabNav } from "../tab-nav";
import { EmptyState, PageHeader, SectionBar } from "../ui";
import { ChanceList } from "./chance-list";
import { BuiltList, GameList } from "./game-list";
import { treeData } from "./tree/data";

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
  const [all, alignments, identities, leagues, perSeason, championships] = await Promise.all([
    loadBrackets(year),
    loadAlignments(),
    loadIdentities(),
    playoffLeagues(year),
    Promise.all(seasons.map(playoffLeagues)),
    past ? [] : stateChampionships(year),
  ]);
  const brackets = all.filter((b) => b.league === league);
  const { date: today } = centralClock();
  // Where each bracket stands (ADR 0094), the latest season only: the round being played and how many teams are still in. The
  // same two facts its own page opens on, from the same code (currentRound, whosLeft over the tree's boxes).
  const standing = past
    ? []
    : await Promise.all(
        brackets.map(async (b) => {
          const round = currentRound(b.rounds, today);
          const left = whosLeft(await treeData(b)).length;
          return { b, round, left };
        }),
      );
  // A season tab keeps the league you are on when that season has it, else opens on UIL.
  const seasonTabs = seasons.map((s, i) => ({
    href: leagueHref(perSeason[i].includes(league) ? league : "UIL", s === seasons[0] ? undefined : s),
    label: String(s),
  }));

  return (
    <section aria-labelledby="playoffs">
      <PageHeader
        id="playoffs"
        eyebrow={`${year} season · ${brackets.length} ${brackets.length === 1 ? "bracket" : "brackets"}`}
        title="Playoffs"
        note={playoffsIntro({ league, season: year, brackets: brackets.map((b) => b.name), past, chances: brackets.some((b) => b.chances || b.regionChances?.length) })}
      />
      {/* The brackets of the latest season, each with its own page (a past season has none). */}
      {!past && brackets.length > 0 && <JsonLd data={rankedList(`${league} playoff brackets`, brackets.map((b) => ({ name: b.name, href: bracketHref(b.name) })))} />}
      {seasons.length > 1 && <TabNav label="Season" wrap tabs={seasonTabs} current={seasonTabs[seasons.indexOf(year)].href} />}
      <TabNav label="League" tabs={leagues.map((l) => ({ href: leagueHref(l, past ? year : undefined), label: l }))} current={leagueHref(league, past ? year : undefined)} />
      {!past && (
        <Link href="/playoffs/this-round" className="mt-3 flex min-h-11 items-center justify-between border-2 border-navy px-3 font-num text-[17px] font-bold uppercase tracking-wide text-navy hover:bg-panel">
          This round in every bracket
          <ChevronRight aria-hidden="true" className="size-5 shrink-0" />
        </Link>
      )}
      {standing.length > 0 && (
        // The round being played in every bracket of this league, before anything else (ADR 0094): a fan should not have to
        // work it out from a list that starts at the first round. Each line jumps to that round below.
        <section aria-labelledby="current-round" data-current-rounds className="mt-4 border-2 border-navy bg-panel">
          <h2 id="current-round" className="px-3 pt-2 font-num text-[20px] font-bold uppercase leading-tight tracking-wider text-navy">
            Current round
          </h2>
          <ul>
            {standing.map(({ b, round, left }) => {
              const id = `bracket-${b.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
              return (
                <li key={b.name} data-bracket={b.name} className="border-t border-line first:border-t-0">
                  {round && (
                    <a href={`#${id}-${round.round}`} className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 px-3 py-1 text-ink hover:bg-page">
                      <span className="font-bold">{bracketLabel(b)}</span>
                      <span className="font-num text-[18px] font-bold uppercase tracking-wide text-navy">
                        {round.label}
                        <span className="font-sans text-[13px] font-normal normal-case tracking-normal text-muted"> · {roundCount(round)}</span>
                      </span>
                    </a>
                  )}
                  {/* The bracket's own page first (a bare link to each bracket leads the page, for the markup that lists them), then its list of who is left. */}
                  <div className="flex flex-wrap items-center justify-between gap-x-4 px-3 text-[14px] font-semibold text-navy">
                    <Link href={bracketHref(b.name)} prefetch={false} className="inline-flex min-h-11 items-center hover:underline">
                      Full {bracketLabel(b)} bracket
                    </Link>
                    {left > 0 && (
                      <Link href={`${bracketHref(b.name)}#whos-left`} prefetch={false} className="inline-flex min-h-11 items-center hover:underline">
                        Who&rsquo;s left: {left} {left === 1 ? "team" : "teams"}
                        <ChevronRight aria-hidden="true" className="size-4" />
                      </Link>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {brackets.length === 0 && (
        <EmptyState action={{ href: "/scores", label: "See this season's scores" }}>
          {past ? `No ${league} playoff games are on record for ${year}.` : `No ${league} bracket has been drawn for ${year} yet. It appears here once the league sets it.`}
        </EmptyState>
      )}
      {brackets.map((b) => {
        const id = `bracket-${b.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
        const roundId = (round: string) => `${id}-${round}`;
        const current = past ? undefined : currentRound(b.rounds, today);
        const championship = championships.find((c) => c.bracket === b.name);
        return (
          <section key={b.name} aria-labelledby={id} className="mt-8">
            <SectionBar id={id} title={b.name} aside={`Latest: ${latestRound(b)!.label}`} className="" />
            {!past && (
              <Link href={bracketHref(b.name)} prefetch={false} className="flex min-h-11 items-center justify-between border-b border-line px-3 font-num text-[16px] font-bold uppercase tracking-wide text-navy hover:bg-panel">
                The {bracketLabel(b)} bracket, latest round first
                <ChevronRight aria-hidden="true" className="size-5 shrink-0" />
              </Link>
            )}
            {championship && <StateChampionshipLink c={championship} className="border-b border-line" />}
            {b.rounds.length > 1 && (
              // Rounds run earliest first, so the latest is far down a phone: one tap gets to any of them.
              <nav aria-label={`${b.name} rounds`} className="flex flex-wrap border-b border-line px-1">
                {b.rounds.map((r) => (
                  <a
                    key={r.round}
                    href={`#${roundId(r.round)}`}
                    aria-current={r === current ? "location" : undefined}
                    className={`inline-flex min-h-11 min-w-11 items-center justify-center px-2 font-num text-[16px] font-bold uppercase tracking-wide underline-offset-4 hover:underline ${r === current ? "bg-band text-white" : "text-navy"}`}
                  >
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
                    · {roundCount(r)}
                    {r === current ? " · current round" : ""}
                  </span>
                </h3>
                {r.games.length > 0 && <GameList games={r.games} league={league} alignments={alignments} identities={identities} today={today} showStatus={!past} comments={past ? undefined : "count"} />}
                {r.built.length > 0 && <BuiltList games={r.built} league={league} alignments={alignments} identities={identities} comments={past ? undefined : "count"} />}
              </section>
            ))}
          </section>
        );
      })}
      <p className="mt-6 text-[13px] text-muted">
        Away team first. Scores may be corrected if a mistake is found. A team&rsquo;s next game shows who went on.
        {!past && " Projections and region and state title chances use the current ratings, with the home edge for the listed home team, except in the State Championship, a neutral site. A region\u2019s chances show once its two area games or its regional game are set."}
      </p>
    </section>
  );
}
