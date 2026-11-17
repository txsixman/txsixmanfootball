import Link from "next/link";
import { sideText } from "@/lib/bracket-fill";
import { bracketHref, loadBrackets, roundLabel } from "@/lib/brackets";
import type { Game } from "@/lib/demo-games";
import { bracketGames, builtGamePages } from "@/lib/game-pages";
import { gameDay } from "@/lib/game-day";
import { ROUNDS } from "@/lib/games";
import { kickoffTime } from "@/lib/kickoff";
import { CURRENT_SEASON } from "@/lib/season";
import { winnerOf } from "@/lib/score-display";
import { whatsNext, type NextEntry } from "@/lib/whats-next";

// After a final (ADR 0087): where the winner goes next, from the bracket the page's own game is in. Only a confirmed final
// names a winner (ADR 0040); a disputed or unconfirmed score, a forfeit with no score and a past season show nothing.

/** The bracket game's next step for its winner, read from the bracket data as built; undefined when there is nothing to say. */
async function next(g: Game & { date: string; round: string }) {
  const side = winnerOf(g);
  if (!side) return undefined;
  const winner = g[side].name;
  const bracket = (await loadBrackets(CURRENT_SEASON)).find((b) => b.rounds.some((r) => r.round === g.round && r.games.some((x) => x.date === g.date && x.home === g.home.name && x.away === g.away.name)));
  if (!bracket) return undefined;
  const [listed, built] = await Promise.all([bracketGames(), builtGamePages()]);
  const rounds = [...new Set([...bracket.rounds.map((r) => r.round), ...bracket.tree.map((n) => n.round)])].sort((a, b) => ROUNDS.indexOf(a) - ROUNDS.indexOf(b));
  const entries: NextEntry[] = bracket.rounds.flatMap((r) => [
    ...r.games.map((x): NextEntry => ({
      round: r.round, label: r.label, teams: [x.home, x.away], text: [x.home, x.away], date: x.date, kickoff: x.kickoff, site: x.site,
      id: listed.find((p) => p.round === r.round && p.date === x.date && p.home.name === x.home && p.away.name === x.away)?.id,
      ...(x.homeScore != null && x.awayScore != null ? { played: { winner: x.confirmed && !x.forfeit && x.homeScore !== x.awayScore ? (x.homeScore > x.awayScore ? x.home : x.away) : null } } : {}),
    })),
    ...r.built.map((x): NextEntry => {
      const [a, b] = x.sides;
      const names = [a, b].flatMap((s) => ("team" in s ? [s.team] : []));
      return {
        round: r.round, label: r.label, teams: ["team" in a ? a.team : null, "team" in b ? b.team : null], text: [sideText(a), sideText(b)], date: x.date, kickoff: x.kickoff, site: x.site,
        id: names.length === 2 ? built.find((p) => p.round === r.round && [p.home.name, p.away.name].sort().join("|") === names.sort().join("|"))?.id : undefined,
      };
    }),
  ]);
  return { winner, bracket, result: whatsNext({ round: g.round, winner, rounds, entries, labelOf: (r) => roundLabel(r, bracket.league) }) };
}

/** "What's next for Jayton": the round, the opponent, the day, kickoff and site when known, linked to the game's page (or the
 * bracket when the game has none yet). Nothing for the last round, a past season or a game with no confirmed winner. */
export async function WhatsNext({ g }: { g: Game }) {
  if (!g.date || !g.round) return null;
  const found = await next({ ...g, date: g.date, round: g.round });
  if (!found || found.result.kind === "last" || found.result.kind === "out") return null;
  const { winner, bracket, result } = found;
  const bracketLink = (
    <Link href={bracketHref(bracket.name)} prefetch={false} className="link-more">
      {bracket.name} bracket
    </Link>
  );
  return (
    <section aria-labelledby="whats-next" data-whats-next data-pagefind-ignore className="mt-5 px-3">
      <h2 id="whats-next" className="mb-1 border-b-2 border-navy pb-1 font-num text-[14px] font-bold uppercase tracking-wider text-navy">
        What&apos;s next for {winner}
      </h2>
      {result.kind === "game" ? (
        <>
          <p className="text-[17px] font-bold leading-6 text-ink">
            {result.label}, {result.known ? `against ${result.opponent}` : result.opponent.startsWith("winner of") ? `against the ${result.opponent}` : "opponent to be decided"}
          </p>
          <p className="text-[15px] leading-5 text-ink">
            {result.date ? [gameDay(result.date), result.kickoff ? kickoffTime(result.kickoff) : "time not listed yet"].join(" · ") : "Day and time not listed yet"}
          </p>
          <p className="text-[15px] leading-5 text-muted">{result.site ? `Site: ${result.site}` : "Site not listed yet"}</p>
          {result.id ? (
            <Link href={`/scores/${result.id}`} className="link-more">
              {result.label} game page
            </Link>
          ) : (
            bracketLink
          )}
        </>
      ) : (
        <>
          <p className="text-[15px] leading-5 text-ink">Moves on to the {result.label}. The opponent, day and site are set as the bracket fills in.</p>
          {bracketLink}
        </>
      )}
    </section>
  );
}
