import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { loadAlignments, programFor } from "@/lib/alignments";
import { bracketHref, loadBrackets, roundLabel } from "@/lib/brackets";
import { EMPTY, loadIdentities, type Identity } from "@/lib/identity";
import { aheadFor, gamesOf } from "@/lib/playoff-path";
import { centralClock, gameStatus } from "@/lib/playoff-status";
import { chanceText, projectionParts } from "@/lib/projection";
import { loadRatings } from "@/lib/ratings";
import { CURRENT_SEASON } from "@/lib/season";
import { UnconfirmedMark } from "../playoffs/game-list";
import { CrestSlot } from "../ui";

/**
 * "Path to the final": this season's games of a team that is in a playoff bracket (one block per bracket: a school in
 * two leagues has two, ADR 0012) round by round, the score marked Unconfirmed where the site cannot vouch for it and
 * naming no winner (ADR 0004), then the games listed ahead with their projections and, where the next pairing is
 * known, the likely opponents (lib/playoff-path.ts). Renders nothing for a team in no bracket.
 */
export async function PathToFinal({ school, accent }: { school: string; accent: string }) {
  const [brackets, alignments, identities, table] = await Promise.all([loadBrackets(CURRENT_SEASON), loadAlignments(), loadIdentities(), loadRatings(CURRENT_SEASON)]);
  const { date: today } = centralClock();
  const paths = brackets.flatMap((b) => {
    const steps = gamesOf(b.rounds, school);
    if (!steps.length) return [];
    const pair = b.pairs.find((p) => p.games.some((g) => g.home === school || g.away === school));
    return [{
      b, steps, ahead: pair && aheadFor(table, pair, school),
      state: b.chances?.find((c) => c.team === school)?.chance,
      region: b.regionChances?.flatMap((r) => r.chances).find((c) => c.team === school)?.chance, // a team is in one region
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
          <Link href={`/programs/${found.slug}`} className="inline-flex min-h-11 items-center hover:text-navy hover:underline">{name}</Link>
        ) : (
          name
        )}
      </>
    );
  };

  return (
    <section aria-labelledby="path" className="mt-4">
      <h2 id="path" className="bg-navy py-1 pl-5 pr-3 font-num text-[20px] font-bold uppercase tracking-wider text-white" style={{ boxShadow: `inset 8px 0 0 ${accent}` }}>
        Path to the final
      </h2>
      {paths.map(({ b, steps, ahead, state, region }) => (
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
                        {home ? "vs" : "at"}&nbsp;{opponent(other, b.league)}
                      </span>
                      <span className="flex flex-wrap items-center gap-x-2 text-[13px] leading-5 text-muted">
                        <span className={status.kind === "tonight" ? "bg-red px-1.5 font-bold text-white" : "font-semibold text-ink"}>{status.label}</span>
                        {status.unconfirmed && <UnconfirmedMark />}
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
          {(state != null || region != null) && (
            <p className="px-3 pt-2 text-[15px] font-semibold text-ink">
              {region != null && <span className="block">Region title chance: {chanceText(region)}</span>}
              {state != null && <span className="block">State title chance: {chanceText(state)}</span>}
            </p>
          )}
        </div>
      ))}
      <p className="px-3 pt-2 text-[13px] text-muted">
        Scores marked Unconfirmed may change, and a team&rsquo;s next game shows who went on. Projections use the current ratings, on a neutral field unless the game is at a home site.
      </p>
    </section>
  );
}
