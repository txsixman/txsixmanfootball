// The parts of a game preview (ADR 0088) that need no file read: a team's last five results, and where the winner goes next in
// its bracket. Pure, one local import: the node tests run it as it is (scripts/game-preview.test.mjs). Scores only, from the
// team's own side; a forfeit is the word, never its 1-0 or 2-0 (ADR 0004); a disputed final names no winner (ADR 0040).
import { slugify } from "./slug.ts";

/** A played game as lib/season-results.ts gives it. */
export type ResultLike = { href: string; date: string; home: string; away: string; homeScore: number; awayScore: number; forfeit: boolean };

/** One of a team's last results: the game's page, the other team, and the score with the team's own first ("42-20"). */
export type LastGame = { href: string; date: string; opponent: string; score: string; mark?: "W" | "L" | "T" };

/**
 * `team`'s last `n` games before `before`, newest first. `disputed` says whether the sources give a game different winners:
 * its score shows with no mark. A forfeit shows the word and no mark, as every results list does.
 */
export function lastGames(team: string, games: ResultLike[], before: string, disputed: (g: ResultLike) => boolean = () => false, n = 5): LastGame[] {
  const me = slugify(team);
  return games
    .filter((g) => g.date < before && (slugify(g.home) === me || slugify(g.away) === me))
    .sort((a, b) => b.date.localeCompare(a.date) || a.href.localeCompare(b.href))
    .slice(0, n)
    .map((g) => {
      const home = slugify(g.home) === me;
      const [us, them] = home ? [g.homeScore, g.awayScore] : [g.awayScore, g.homeScore];
      const base = { href: g.href, date: g.date, opponent: home ? g.away : g.home };
      if (g.forfeit) return { ...base, score: "Forfeit" };
      return { ...base, score: `${us}-${them}`, ...(disputed(g) ? {} : { mark: us > them ? ("W" as const) : us < them ? ("L" as const) : ("T" as const) }) };
    });
}

type Side = { text: string; team?: string; bye?: true };
/** A box of a bracket's tree (lib/bracket-tree.ts TreeGame): the slot, the slots feeding its two sides, its two sides, and the
 * date, kickoff (UTC) and site the league's own bracket lists for it. */
export type PathNode = { id: string; round: string; feeds: [string | null, string | null]; sides: [Side, Side]; kickoff_utc?: string; site?: string };

/** What a game's winner goes on to: the next round's game. `other` is the opponent's side as the bracket words it: a team, or
 * the winner of two known teams. Nothing here is guessed: the date, kickoff and site are the league's own, when it lists them. */
export type NextGame = {
  round: string;
  other?: { text: string; team?: string };
  /** Central date, "YYYY-MM-DD", and the kickoff in UTC. */
  date?: string;
  kickoff?: string;
  site?: string;
};

/** A date in Central time, "YYYY-MM-DD" (a 7 PM Friday kickoff is already Saturday in UTC). */
const centralDate = (utc: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date(utc));

const teamsOf = (n: PathNode) => n.sides.flatMap((s) => (s.team ? [slugify(s.team)] : []));

/** The box of a tree that holds `round` between `a` and `b`, either way round. */
export function boxOf<N extends PathNode>(tree: N[], round: string, a: string, b: string): N | undefined {
  const pair = [slugify(a), slugify(b)].sort().join("|");
  return tree.find((n) => n.round === round && teamsOf(n).length === 2 && teamsOf(n).sort().join("|") === pair);
}

/**
 * The game after the one `round` between `a` and `b` in a bracket's tree: the box fed by this game's box. Undefined when the
 * game is in no box (a game the bracket does not place), nothing is fed by it (a State Championship, or a bracket whose
 * later rounds no data closes), or the winner has a bye.
 */
export function nextGame(tree: PathNode[], round: string, a: string, b: string): NextGame | undefined {
  const mine = boxOf(tree, round, a, b);
  if (!mine) return undefined;
  const next = tree.find((n) => n.feeds.includes(mine.id));
  if (!next) return undefined;
  const at = next.feeds.indexOf(mine.id);
  const side = next.sides[at === 0 ? 1 : 0];
  if (next.sides.some((s) => s.bye)) return undefined;
  // The opponent's side: a team, or the winner of the box that feeds it, by its two teams when both are known.
  const feeder = tree.find((n) => n.id === next.feeds[at === 0 ? 1 : 0]);
  const [x, y] = feeder?.sides ?? [];
  const other: NextGame["other"] =
    side.team ? { text: side.team, team: side.team }
    : x?.team && y?.team ? { text: `winner of ${x.team} and ${y.team}` }
    : /^Winner of /.test(side.text) ? { text: side.text.replace(/^Winner of /, "winner of ") }
    : undefined;
  return {
    round: next.round,
    ...(other ? { other } : {}),
    ...(next.kickoff_utc ? { date: centralDate(next.kickoff_utc), kickoff: next.kickoff_utc } : {}),
    ...(next.site ? { site: next.site } : {}),
  };
}
