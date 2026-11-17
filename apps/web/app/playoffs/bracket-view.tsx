import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { loadAlignments } from "@/lib/alignments";
import { bracketHref, bracketLabel, type Bracket, latestRound, roundLabel } from "@/lib/brackets";
import { bracketGames, builtGamePages } from "@/lib/game-pages";
import { loadIdentities } from "@/lib/identity";
import { bracketIntro } from "@/lib/intros";
import { bracketGamesList, breadcrumbList } from "@/lib/json-ld";
import { previewOf } from "@/lib/playoff-path";
import { centralClock, currentRound } from "@/lib/playoff-status";
import { roundCount } from "@/lib/this-round";
import { chanceText, chanceTexts, projectionParts } from "@/lib/projection";
import { loadRatings } from "@/lib/ratings";
import { CURRENT_SEASON } from "@/lib/season";
import { stateChampionships } from "@/lib/state-championships";
import { SITE_URL } from "@/lib/site";
import { slugify } from "@/lib/slug";
import { StateChampionshipLink } from "../championships/shared";
import { JsonLd } from "../json-ld";
import { TabNav } from "../tab-nav";
import { PageHeader } from "../ui";
import { AdvanceTable } from "./advance-table";
import { ChanceList } from "./chance-list";
import { BuiltList, GameList } from "./game-list";
import { BracketBoard } from "./tree/board";
import { treeData } from "./tree/data";

/** [program slug, { text, chance }] for every team of an advancement table that has a chance to win the State Championship; the same words as the table's last column. */
const titleChances = (a: NonNullable<Bracket["advancement"]>) => {
  const all = a.rows.every((r) => r.title !== undefined);
  const texts = all ? chanceTexts(a.rows.map((r) => r.title!)) : a.rows.map((r) => (r.title === undefined ? "" : chanceText(r.title)));
  return a.rows.flatMap((r, i) => (r.title === undefined ? [] : [[slugify(r.team), { text: texts[i], chance: r.title }] as const]));
};

const leagueHref = (league: string) => (league === "UIL" ? "/playoffs" : `/playoffs/${league.toLowerCase()}`);

/**
 * One bracket on its own page: the round being played first, every game's status (not yet played, tonight, score
 * reported, forfeit), projections for games not yet played and for the next pairing. The site is static: this page is
 * rebuilt when the results robot commits new scores, so "scores as of" is the time of that build. A robot-read score is
 * unconfirmed and names no winner (ADR 0004); a bracket may go on from one (ADR 0013).
 */
export async function BracketView({ bracket: b, siblings }: { bracket: Bracket; siblings: Bracket[] }) {
  const [alignments, identities, table, tree] = await Promise.all([loadAlignments(), loadIdentities(), loadRatings(CURRENT_SEASON), treeData(b)]);
  const championship = (await stateChampionships(CURRENT_SEASON)).find((c) => c.bracket === b.name);
  const clock = centralClock();
  const current = currentRound(b.rounds, clock.date);
  const rounds = [...(current ? [current] : []), ...b.rounds.filter((r) => r !== current)];
  const previews = b.pairs.flatMap((pair) => {
    const preview = previewOf(table, pair);
    return preview ? [{ pair, ...preview }] : [];
  });
  const roundId = (round: string) => `round-${round}`;
  // Each team still in and its chance to win the State Championship (ADR 0071), for "Who's left" (ADR 0094): worded together as the
  // table below words them, so the two agree. A team with no chance to give (too few games) has none listed.
  const titles = b.advancement ? Object.fromEntries(titleChances(b.advancement)) : {};
  // The games that have a page of their own, earliest round first, for search engines: listed games, then in each round the
  // games the bracket sets with both teams known (ADR 0079), in the page's order, with the day and kickoff once known.
  const pages = new Map((await bracketGames()).filter((g) => g.id.startsWith(`${CURRENT_SEASON}-`)).map((g) => [`${g.date}|${g.home.name}|${g.away.name}`, g.id]));
  const pairOf = (round: string, x: string, y: string) => [round, ...[x, y].sort()].join("|");
  const builtPages = new Map((await builtGamePages()).map((g) => [pairOf(g.round ?? "", g.home.name, g.away.name), g]));
  const listed = b.rounds.flatMap((r) => [
    ...r.games.flatMap((g) => {
      const id = pages.get(`${g.date}|${g.home}|${g.away}`);
      return id ? [{ away: g.away, home: g.home, date: g.date, kickoff: g.kickoff, url: `${SITE_URL}/scores/${id}` }] : [];
    }),
    ...r.built.flatMap(({ round, sides: [x, y] }) => {
      const g = "team" in x && "team" in y ? builtPages.get(pairOf(round, x.team, y.team)) : undefined;
      return g ? [{ away: g.away.name, home: g.home.name, date: g.date, kickoff: g.kickoff, url: `${SITE_URL}/scores/${g.id}` }] : [];
    }),
  ]);

  return (
    <section aria-labelledby="bracket">
      <div className="print:hidden">
      <nav aria-label="Back" className="-mx-1">
        <Link href={leagueHref(b.league)} className="inline-flex min-h-11 items-center gap-1.5 px-1 text-[14px] font-semibold text-navy">
          <ArrowLeft aria-hidden="true" className="size-4" strokeWidth={2.5} />
          All {b.league} playoffs
        </Link>
      </nav>
      {/* The back link is the trail on screen; search engines get the same trail as markup. */}
      <JsonLd data={breadcrumbList([{ name: "Home", href: "/" }, { name: `${b.league} playoffs`, href: leagueHref(b.league) }, { name: b.name, href: bracketHref(b.name) }])} />
      {listed.length > 0 && <JsonLd data={bracketGamesList(`${b.name} games`, listed)} />}
      <PageHeader id="bracket" size="md" eyebrow={`${CURRENT_SEASON} season · ${b.league} · latest: ${latestRound(b)!.label}`} title={b.name} note={bracketIntro({ name: b.name, season: CURRENT_SEASON })} />
      {siblings.length > 1 && (
        <TabNav label={`${b.league} brackets`} tabs={siblings.map((s) => ({ href: bracketHref(s.name), label: bracketLabel(s) }))} current={bracketHref(b.name)} wrap />
      )}

      {championship && <StateChampionshipLink c={championship} className="mt-4 border-2 border-navy" />}

      <div className="mt-4 border-2 border-navy bg-panel px-3 py-2">
        <p className="font-num text-[22px] font-bold uppercase leading-tight tracking-wide text-navy">Scores as of {clock.label}</p>
        <p className="mt-1 text-[14px] leading-5 text-ink">
          This page is rebuilt with the newest scores read, about every 30 minutes on playoff Friday nights. Scores may be corrected if a mistake is found.
        </p>
      </div>
      </div>

      <BracketBoard data={tree} imageBase={`${bracketHref(b.name)}/image`} current={current?.round} titles={titles} />

      {b.advancement && <AdvanceTable advancement={b.advancement} league={b.league} identities={identities} />}

      <div id="games-by-round" className="scroll-mt-4 print:hidden">
      {b.rounds.length > 1 && (
        <nav aria-label={`${b.name} rounds`} className="mt-3 flex flex-wrap border-b border-line px-1">
          {b.rounds.map((r) => (
            <a
              key={r.round}
              href={`#${roundId(r.round)}`}
              aria-current={r === current ? "location" : undefined}
              className={`inline-flex min-h-11 items-center px-2 font-num text-[17px] font-bold uppercase tracking-wide underline-offset-4 hover:underline ${r === current ? "bg-band text-white" : "text-navy"}`}
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
              · {roundCount(r)}
              {r === current ? " · current round" : ""}
            </span>
          </h2>
          {r.games.length > 0 && <GameList games={r.games} league={b.league} alignments={alignments} identities={identities} today={clock.date} comments="count" />}
          {r.built.length > 0 && <BuiltList games={r.built} league={b.league} alignments={alignments} identities={identities} comments="count" />}
        </section>
      ))}

      <p className="mt-6 text-[13px] text-muted">
        Away team first. Projections and title chances use the current ratings, with the home edge for the listed home team, except in the State Championship, a neutral site. A team&rsquo;s next game shows who went on.
      </p>
      </div>
    </section>
  );
}
