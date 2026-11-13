// What a game preview says about two teams from games already played: the opponents both met this season, with each
// team's score against each. Scores only, from the team's own side, never a word for how a game went: every robot-read
// score is unconfirmed (ADR 0004, ADR 0013), and a forfeit is the word, never its recorded 1-0 or 2-0. Pure: the node
// tests run it as it is.
import { slugify } from "./slug";

export type PreviewGame = { date: string; home: string; away: string; homeScore: number; awayScore: number; forfeit: boolean };

/** One opponent both teams met: each team's scores against it, oldest first, in the team's own order ("42–20", or "Forfeit"). */
export type CommonOpponent = { opponent: string; a: string[]; b: string[]; latest: string };

const scoreOf = (team: string, g: PreviewGame) => (g.forfeit ? "Forfeit" : slugify(g.home) === slugify(team) ? `${g.homeScore}–${g.awayScore}` : `${g.awayScore}–${g.homeScore}`);

/** `team`'s games before `before`, by opponent slug (a game against `exclude` is left out). */
function byOpponent(team: string, games: PreviewGame[], before: string, exclude: string) {
  const out = new Map<string, { name: string; games: PreviewGame[] }>();
  for (const g of [...games].sort((x, y) => x.date.localeCompare(y.date))) {
    if (g.date >= before) continue;
    const name = slugify(g.home) === slugify(team) ? g.away : g.home;
    const slug = slugify(name);
    if (slug === exclude || slug === slugify(team)) continue;
    const entry = out.get(slug) ?? { name, games: [] };
    entry.games.push(g);
    out.set(slug, entry);
  }
  return out;
}

/**
 * The opponents both teams played in `aGames` and `bGames` (one season's games of each) before `before`, newest first, then by
 * name. Their games against each other are not common opponents. `shown` is at most `cap`; `rest` is how many more there are.
 */
export function commonOpponents(a: string, b: string, aGames: PreviewGame[], bGames: PreviewGame[], before: string, cap = 8): { shown: CommonOpponent[]; rest: number } {
  const [mine, theirs] = [byOpponent(a, aGames, before, slugify(b)), byOpponent(b, bGames, before, slugify(a))];
  const all = [...mine].flatMap(([slug, m]) => {
    const t = theirs.get(slug);
    return t
      ? [{ opponent: m.name, a: m.games.map((g) => scoreOf(a, g)), b: t.games.map((g) => scoreOf(b, g)), latest: [...m.games, ...t.games].map((g) => g.date).sort().at(-1)! }]
      : [];
  });
  all.sort((x, y) => y.latest.localeCompare(x.latest) || x.opponent.localeCompare(y.opponent));
  return { shown: all.slice(0, cap), rest: Math.max(0, all.length - cap) };
}
