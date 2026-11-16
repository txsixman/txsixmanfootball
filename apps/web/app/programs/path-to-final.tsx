import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { KickoffStatus } from "../kickoff-status";
import { loadAlignments, programFor } from "@/lib/alignments";
import { sideText } from "@/lib/bracket-fill";
import { type Bracket, bracketHref, loadBrackets, roundLabel } from "@/lib/brackets";
import { gameDay } from "@/lib/game-day";
import { EMPTY, loadIdentities, type Identity } from "@/lib/identity";
import { aheadFor, gamesOf } from "@/lib/playoff-path";
import { centralClock, gameStatus } from "@/lib/playoff-status";
import { chanceText, projectionParts } from "@/lib/projection";
import { loadRatings } from "@/lib/ratings";
import { CURRENT_SEASON } from "@/lib/season";
import { DisputedMark } from "../playoffs/game-list";
import { CrestSlot } from "../ui";

/** "Projected: 61% to reach the regional round, 12% to win the State Championship." for a team still in (ADR 0071): the
 * first round still to be set that it is not already in. "Not enough games to project." when it cannot be said. */
function advanceLine(b: Pick<Bracket, "advancement" | "league">, school: string): string | undefined {
  const a = b.advancement;
  const row = a?.rows.find((r) => r.team === school);
  if (!a || !row) return undefined;
  if (row.title === undefined) return "Projected: not enough games to project.";
  const title = row.title === 1 ? undefined : chanceText(row.title);
  const i = row.reach.findIndex((p) => p !== 1);
  const round = i < 0 ? undefined : roundLabel(a.rounds[i], b.league);
  const reach = i < 0 || row.reach[i] === undefined ? undefined : `${chanceText(row.reach[i]!)} to reach ${round === "State Championship" ? "the State Championship" : `the ${round!.toLowerCase()} round`}`;
  return `Projected: ${[reach, title && `${title} to win the State Championship`].filter(Boolean).join(", ")}.`;
}

/**
 * "Path to the final": this season's games of a team that is in a playoff bracket (one block per bracket: a school in
 * two leagues has two, ADR 0012) round by round, each final with its score (ADR 0040), then the games listed ahead with their projections and, where the next pairing is
 * known, the likely opponents (lib/playoff-path.ts). Renders nothing for a team in no bracket.
 */
export async function PathToFinal({ school, accent }: { school: string; accent: string }) {
  const [brackets, alignments, identities, table] = await Promise.all([loadBrackets(CURRENT_SEASON), loadAlignments(), loadIdentities(), loadRatings(CURRENT_SEASON)]);
  const { date: today } = centralClock();
  const paths = brackets.flatMap((b) => {
    const steps = gamesOf(b.rounds, school);
    if (!steps.length) return [];
    const pair = b.pairs.find((p) => p.games.some((g) => g.home === school || g.away === school));
    // The next game the bracket sets before a site lists it (ADR 0047): firmer than the "if it advances" guess, so it replaces it.
    const next = b.rounds.flatMap((r) => r.built.map((g) => ({ ...g, label: r.label }))).find((g) => g.sides.some((s) => "team" in s && s.team === school));
    return [{
      b, steps, next, ahead: !next && pair ? aheadFor(table, pair, school) : undefined,
      state: b.chances?.find((c) => c.team === school)?.shown,
      advance: advanceLine(b, school),
      region: b.regionChances?.flatMap((r) => r.chances).find((c) => c.team === school)?.shown, // a team is in one region
    }];
  });
  if (!paths.length) return null;

  const crest = (name: string, identity: Identity | undefined) => (identity ? <CrestSlot school={name} identity={identity} /> : <span aria-hidden="true" className="mr-2 w-10 shrink-0" />);
  const opponent = (name: string, league: string) => {
    const found = programFor(alignments, name, league);
    return (
      <>
        {crest(name, found && (identities.get(found.slug) ?? EMPTY))}
        {found ? (
          <Link href={`/programs/${found.slug}`} prefetch={false} className="name-link">{name}</Link>
        ) : (
          name
        )}
      </>
    );
  };

  return (
    <section aria-labelledby="path" className="mt-4">
      <h2 id="path" className="bg-band py-1 pl-5 pr-3 font-num text-[20px] font-bold uppercase tracking-wider text-white" style={{ boxShadow: `inset 8px 0 0 ${accent}` }}>
        Path to the State Championship
      </h2>
      {paths.map(({ b, steps, next, ahead, state, region, advance }) => (
        <div key={b.name}>
          <h3 className="border-b border-line">
            <Link href={bracketHref(b.name)} className="flex min-h-11 items-center justify-between px-3 font-num text-[17px] font-bold uppercase tracking-wide text-navy hover:bg-panel">
              {b.name} bracket
              <ChevronRight aria-hidden="true" className="size-5 shrink-0" />
            </Link>
          </h3>
          <ol>
            {steps.map(({ round, label, game, opponent: other, home }) => {
              const status = gameStatus(game, today);
              const [us, them] = home ? [game.homeScore, game.awayScore] : [game.awayScore, game.homeScore];
              const proj = game.projection && !game.forfeit ? projectionParts(game.projection) : undefined;
              return (
                <li key={round} className="border-b border-line px-3 py-1.5">
                  <div className="grid grid-cols-[4.5rem_1fr_auto] items-center gap-x-3">
                    <span className="font-num text-[14px] font-bold uppercase leading-tight text-navy">{label}</span>
                    <span className="min-w-0 text-[15px] leading-5 text-ink">
                      <span className="flex items-center">
                        vs&nbsp;{opponent(other, b.league)}
                      </span>
                      <span className="flex flex-wrap items-center gap-x-2 text-[13px] leading-5 text-muted">
                        {["scheduled", "tonight", "awaiting"].includes(status.kind) ? (
                          <KickoffStatus date={game.date} kickoff={game.kickoff} className="font-semibold" />
                        ) : (
                          <span className="font-semibold text-ink">{status.label}</span>
                        )}
                        {status.unconfirmed && <DisputedMark />}
                      </span>
                    </span>
                    <span className="font-num text-[28px] font-bold leading-none tabular-nums text-ink">
                      {game.forfeit ? <span className="text-[20px]">Forfeit</span> : us != null ? `${us}-${them}` : ""}
                    </span>
                  </div>
                  {proj && (
                    <p className="pl-[4.75rem] text-[15px] font-semibold text-navy">
                      <span>Projected: {proj.margin}</span> · <span className="whitespace-nowrap">{proj.chance}</span>
                    </p>
                  )}
                </li>
              );
            })}
            {next && (() => {
              const other = next.sides.find((s) => !("team" in s && s.team === school))!;
              const proj = next.projection && projectionParts(next.projection);
              return (
                <li data-built className="border-b border-dashed border-line px-3 py-1.5">
                  <div className="grid grid-cols-[4.5rem_1fr] items-center gap-x-3">
                    <span className="font-num text-[14px] font-bold uppercase leading-tight text-navy">{next.label}</span>
                    <span className="min-w-0 text-[15px] leading-5 text-ink">
                      <span className="flex items-center">vs&nbsp;{"team" in other ? opponent(other.team, b.league) : sideText(other)}</span>
                      {/* The day, kickoff and site the read found for this pairing before any listing has it (ADR 0067). */}
                      {next.date ? (
                        <span className="block text-[13px] leading-5 text-muted">
                          Next game · {gameDay(next.date)} · <KickoffStatus date={next.date} kickoff={next.kickoff} className="font-semibold" />
                          <span className="block">{next.site ? `Site: ${next.site}` : "Site not listed yet"}</span>
                        </span>
                      ) : (
                        <span className="text-[13px] leading-5 text-muted">Next game · date and site not listed yet</span>
                      )}
                    </span>
                  </div>
                  {proj && (
                    <p className="pl-[4.75rem] text-[15px] font-semibold text-navy">
                      <span>Projected: {proj.margin}</span> · <span className="whitespace-nowrap">{proj.chance}</span>
                    </p>
                  )}
                </li>
              );
            })()}
            {ahead && (
              <li className="border-b border-line bg-panel px-3 py-2">
                <p className="font-num text-[14px] font-bold uppercase tracking-wide text-navy">If it advances: {roundLabel(ahead.next, b.league)}</p>
                {ahead.candidates.map((c, i) => {
                  const p = projectionParts(c.projection);
                  return (
                    <p key={c.team} className="text-[15px] leading-6 text-ink">
                      <span className="font-semibold">{i === 0 ? "Likely opponent" : "Other possibility"}: {c.team}</span> ({chanceText(c.reach)} to get there)
                      <span className="block font-semibold text-navy">
                        <span>Projected: {p.margin}</span> · <span className="whitespace-nowrap">{p.chance}</span>
                      </span>
                    </p>
                  );
                })}
              </li>
            )}
          </ol>
          {(state != null || region != null || advance) && (
            <p className="px-3 pt-2 text-[15px] font-semibold text-ink">
              {advance && (
                <span data-advance className="block text-navy">
                  {advance} <span className="font-normal text-muted">A projection, not a result.</span>
                </span>
              )}
              {region != null && <span className="block">Region title chance: {region}</span>}
              {/* The line above says the same from the whole bracket. */}
              {state != null && !advance && <span className="block">State title chance: {state}</span>}
            </p>
          )}
        </div>
      ))}
      <p className="px-3 pt-2 text-[13px] text-muted">
        Scores may be corrected if a mistake is found. A team&rsquo;s next game shows who went on. Projections use the current ratings, with the home edge for the listed home team, except in the State Championship, a neutral site.
      </p>
    </section>
  );
}
