// What the share card of /scores/tonight and /playoffs/this-round says about each game (app/friday-card.tsx draws it). Pure,
// no imports: the node tests run it as it is. A game still to play shows its projection ("Jayton by 12 · 74% chance to
// win"), a finished one its score under "Final" ("Score reported" when it is not confirmed, as the pages say), a forfeit
// the word and never a score (ADR 0004). Nothing names a winner. An organization's games carry its own tag (ADR 0012).

export type CardGame = {
  /** The league and division or round the page labels the game with. */
  tag: string;
  away: string;
  home: string;
  state: "later" | "final" | "forfeit";
  awayScore?: number | null;
  homeScore?: number | null;
  /** False for a disputed or not-yet-confirmed score. */
  confirmed: boolean;
  /** "Jayton by 12 · 74% chance to win", for a game not yet played. */
  projected?: string;
};
export type CardCell = { tag: string; away: string; home: string; awayScore?: number; homeScore?: number; status: string };

/** Games drawn on a card; the rest are "+N more". */
const CARD_GAMES = 6;

/** The last playoff round is always the State Championship, never "final" (UIL's "State final", another league's "Final"). */
export const roundName = (label: string) => (/^(state )?final$/i.test(label.trim()) ? "State Championship" : label);

export function cardCells(games: CardGame[], max = CARD_GAMES): { cells: CardCell[]; more: number } {
  const cells = games.slice(0, max).map((g): CardCell => {
    const base = { tag: g.tag, away: g.away, home: g.home };
    if (g.state === "forfeit") return { ...base, status: "Forfeit" };
    if (g.state === "final" && g.awayScore != null && g.homeScore != null) {
      return { ...base, awayScore: g.awayScore, homeScore: g.homeScore, status: g.confirmed ? "Final" : "Score reported" };
    }
    return { ...base, status: g.projected ?? "Not yet played" };
  });
  return { cells, more: Math.max(0, games.length - cells.length) };
}

/** "+3 more", or nothing. */
export const moreText = (more: number) => (more > 0 ? `+${more} more` : "");

/** "9 games", "1 game". */
export const gamesText = (n: number) => `${n} ${n === 1 ? "game" : "games"}`;
