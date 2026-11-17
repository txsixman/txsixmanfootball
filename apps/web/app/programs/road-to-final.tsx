import { ChevronRight, Trophy } from "lucide-react";
import Link from "next/link";
import { loadAlignments, programFor } from "@/lib/alignments";
import { type Bracket, bracketHref, loadBrackets, roundLabel } from "@/lib/brackets";
import { gameDay } from "@/lib/game-day";
import { bracketGames, builtGamePages } from "@/lib/game-pages";
import { EMPTY, loadIdentities } from "@/lib/identity";
import type { PlayoffGame } from "@/lib/games";
import { kickoffTime } from "@/lib/kickoff";
import { chanceText, projectionParts } from "@/lib/projection";
import type { RoadStep } from "@/lib/road";
import { CURRENT_SEASON } from "@/lib/season";
import { CrestSlot } from "../ui";

// "Road to the State Championship" on a program page (ADR 0104): for a team still in a bracket this season, each round it has
// still to play, in the bracket's own round names and ending in "State Championship". Its next game comes first, with the
// game's page; every round gives the chance to reach and to win it, and who it could meet there, each linked to its program
// with the chance of being there and the projected margin. A team that is out has one line instead, and a champion says so.
// Everything is in the page's HTML (worked out at build time: nothing here reads a clock, so nothing moves after load), from
// the same slot-by-slot chances as the bracket page's table (lib/road.ts, lib/advancement.ts). A projection, not a result.

/** A chance this close to 1 is a sure thing (a team already in the game; sums of shares can miss 1 by rounding). */
const SURE = 0.9999;

/** "Fri, Nov 20 · 7:00 PM CT": a Central date (YYYY-MM-DD) and a UTC kickoff, either missing; undefined with neither. */
const whenText = (date?: string, kickoff?: string) => [date && gameDay(date), kickoff && kickoffTime(kickoff)].filter(Boolean).join(" · ") || undefined;
const centralDate = (utc: string) => new Date(utc).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

/** What a step knows about its day and place: the listed game's, else what the bracket sets for this pairing before any listing has
 * it (ADR 0067), else what the league's own bracket lists for the slot. */
function whereWhen(b: Bracket, step: RoadStep<PlayoffGame>, team: string) {
  const g = step.game;
  if (g) return { when: whenText(g.date, g.kickoff), site: g.site };
  const set = step.opponents.length === 1 ? b.rounds.flatMap((r) => r.built).find((x) => x.round === step.round && x.sides.some((s) => "team" in s && s.team === team)) : undefined;
  if (set?.date) return { when: whenText(set.date, set.kickoff), site: set.site };
  return { when: step.kickoff_utc ? whenText(centralDate(step.kickoff_utc), step.kickoff_utc) : undefined, site: step.site };
}

/** "Chance to reach it: 61% · Chance to win it: 38%": nothing for a reach already settled (the team is in its next game) or a bye's win. */
function chancesText(step: RoadStep<PlayoffGame>): string {
  if (step.win === undefined && step.reach === undefined) return "Not enough games to project this round.";
  const reach = step.reach !== undefined && step.reach < SURE ? `Chance to reach it: ${chanceText(step.reach)}` : undefined;
  const win = step.kind === "bye" ? undefined : step.win !== undefined ? `Chance to win it: ${chanceText(step.win)}` : "Not enough games to project its chance to win";
  return [reach, win].filter(Boolean).join(" · ");
}

export async function RoadToChampionship({ school, accent }: { school: string; accent: string }) {
  const [brackets, alignments, identities, pages, built] = await Promise.all([loadBrackets(CURRENT_SEASON), loadAlignments(), loadIdentities(), bracketGames(), builtGamePages()]);
  const roads = brackets.flatMap((b) => {
    const road = b.roads?.get(school);
    return road ? [{ b, road }] : [];
  });
  if (!roads.length) return null;
  const pair = (x: string, y: string) => [x, y].sort().join("|");
  const hrefs = new Map(pages.map((p) => [`${p.date}|${p.home.name}|${p.away.name}`, { href: `/scores/${p.id}`, text: `${p.away.name} vs ${p.home.name}` }]));
  /** A step's game page: a listed game's, or the page of a pairing the bracket sets once both teams are known (ADR 0079). */
  const gamePage = (step: RoadStep<PlayoffGame>, team: string) => {
    if (step.game) return hrefs.get(`${step.game.date}|${step.game.home}|${step.game.away}`);
    const other = step.opponents.length === 1 && step.opponents[0].reach > SURE ? step.opponents[0].team : undefined;
    const p = other && built.find((x) => x.round === step.round && pair(x.home.name, x.away.name) === pair(team, other));
    return p ? { href: `/scores/${p.id}`, text: `${p.away.name} vs ${p.home.name}` } : undefined;
  };
  const alive = roads.filter((r) => r.road.state !== "out");
  const outs = roads.filter((r) => r.road.state === "out").map(({ b, road }) => (
    <p key={b.name} data-road-out className="px-3 pt-2 text-[15px] font-semibold text-ink">
      Out in the {roundLabel(road.outRound!, b.league).toLowerCase()} round of the {b.name} bracket.
    </p>
  ));
  if (!alive.length) return <div className="mt-4">{outs}</div>;

  const opponent = (name: string, league: string) => {
    const found = programFor(alignments, name, league);
    return (
      <>
        {found && <CrestSlot school={name} identity={identities.get(found.slug) ?? EMPTY} />}
        {found ? (
          <Link href={`/programs/${found.slug}`} prefetch={false} className="name-link font-semibold text-navy underline underline-offset-2">{name}</Link>
        ) : (
          <span className="font-semibold text-ink">{name}</span>
        )}
      </>
    );
  };

  return (
    <section aria-labelledby="road" data-road className="mt-4 scroll-mt-4">
      <h2 id="road" className="bg-band py-1 pl-5 pr-3 font-num text-[20px] font-bold uppercase tracking-wider text-white" style={{ boxShadow: `inset 8px 0 0 ${accent}` }}>
        Road to the State Championship
      </h2>
      {alive.map(({ b, road }) => (
        <div key={b.name} data-road-bracket={b.name}>
          <h3 className="border-b border-line">
            <Link href={bracketHref(b.name)} className="flex min-h-11 items-center justify-between px-3 font-num text-[17px] font-bold uppercase tracking-wide text-navy hover:bg-panel">
              {b.name} bracket
              <ChevronRight aria-hidden="true" className="size-5 shrink-0" />
            </Link>
          </h3>
          {road.byes.length > 0 && <p className="px-3 pt-2 text-[14px] text-muted">Bye in the {road.byes.map((r) => roundLabel(r, b.league).toLowerCase()).join(" and ")} round.</p>}
          {road.state === "champion" ? (
            <p className="flex items-center gap-1.5 px-3 pt-2 font-num text-[20px] font-bold uppercase leading-tight tracking-wide text-navy">
              <Trophy aria-hidden="true" className="size-5 shrink-0 text-red" />
              {CURRENT_SEASON} State Champion
            </p>
          ) : road.steps.length === 0 ? (
            <p className="px-3 pt-2 text-[15px] text-ink">Its next game is not set yet.</p>
          ) : (
            <ol>
              {road.steps.map((step, i) => {
                const next = i === 0;
                const { when, site } = whereWhen(b, step, school);
                const page = next ? gamePage(step, school) : undefined;
                const sure = step.opponents.length === 1 && step.opponents[0].reach > SURE;
                return (
                  <li key={step.slot} data-road-step={next ? "next" : "ahead"} data-round={step.round} className="border-b border-line px-3 py-2">
                    <p className="font-num text-[16px] font-bold uppercase leading-tight tracking-wide text-navy">
                      {roundLabel(step.round, b.league)}
                      {next && <span className="text-red"> · {step.reported ? "Score not confirmed yet" : "Next game"}</span>}
                    </p>
                    <p className="text-[14px] leading-5 text-muted">
                      {step.reported ? "Played: the score is reported, not confirmed, so the game still counts as undecided." : step.kind === "bye" ? "Bye: goes on without playing." : (when ?? "Date not listed yet")}
                      {!step.reported && step.kind === "game" && next && <span className="block">{site ? `Site: ${site}` : "Site not listed yet"}</span>}
                    </p>
                    <p className="text-[15px] font-semibold leading-6 text-ink">{chancesText(step)}</p>
                    {step.unknown && <p className="text-[14px] text-muted">Who it could meet is not known yet.</p>}
                    {step.opponents.length > 0 && (
                      <>
                        <p className="pt-1 text-[13px] font-bold uppercase tracking-wider text-muted">{sure ? "Opponent" : step.opponents.length === 1 ? "Likely opponent" : "Could meet"}</p>
                        <ul>
                          {step.opponents.map((o) => {
                            const p = o.projection && projectionParts(o.projection);
                            return (
                              <li key={o.team} className="py-0.5">
                                <div className="flex flex-wrap items-center gap-x-2 text-[15px] leading-5 text-ink">
                                  {opponent(o.team, b.league)}
                                  {!sure && <span className="text-[14px] text-muted">{chanceText(o.reach)} to get there</span>}
                                </div>
                                <p className="pl-12 text-[15px] font-semibold leading-5 text-navy">
                                  {p ? (
                                    <>
                                      <span>Projected: {p.margin}</span> · <span className="whitespace-nowrap">{p.chance}</span>
                                    </>
                                  ) : (
                                    "Not enough games to project"
                                  )}
                                </p>
                              </li>
                            );
                          })}
                        </ul>
                        {step.more && (
                          <p className="text-[14px] text-muted">
                            {step.more.count} other {step.more.count === 1 ? "team" : "teams"}, {chanceText(step.more.reach)} together.
                          </p>
                        )}
                      </>
                    )}
                    {page && (
                      <Link href={page.href} className="inline-flex min-h-11 items-center gap-1 text-[15px] font-semibold text-navy underline underline-offset-2">
                        Game page
                        <ChevronRight aria-hidden="true" className="size-4" />
                        <span className="sr-only"> for {page.text}</span>
                      </Link>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      ))}
      {outs}
      <p className="px-3 pt-2 text-[13px] text-muted">
        A projection, not a result. Chances and margins come from the current ratings, the same as the bracket&rsquo;s table of chances, with the home edge for the
        listed home team, except in the State Championship, a neutral site. A score that is not yet confirmed does not move a team on.
      </p>
    </section>
  );
}
