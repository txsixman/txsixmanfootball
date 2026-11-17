import type { Game } from "./demo-games";
import type { Identity } from "./identity"; // the type only: lib/identity.ts reads files

/**
 * What the scores board (app/scores/board.tsx, a client component) is sent. Its props travel in the page's data once more
 * beside the HTML it draws (the board's props were 134 KB of /scores' 149 KB of page data), so a field the board never reads
 * is a field every phone downloads for nothing: a team's mascot, initials and color, a game's site, street address, projected
 * margin, stream and quarters, and every key that is only `undefined` (ADR 0100). Plain data, so a server page may call it.
 */
type BoardTeam = Pick<Game["home"], "name" | "record" | "rank">;
export type BoardGame = Omit<Game, "home" | "away" | "venue" | "address" | "projectedMargin" | "stream" | "quarters"> & { home: BoardTeam; away: BoardTeam };

const defined = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
const team = (t: Game["home"]): BoardTeam => defined({ name: t.name, record: t.record, rank: t.rank });

export function boardGame(g: Game): BoardGame {
  const { venue: _venue, address: _address, projectedMargin: _margin, stream: _stream, quarters: _quarters, ...rest } = g;
  return defined({ ...rest, home: team(g.home), away: team(g.away) });
}

/** A crest as the board draws it, 24 px high: the tiny copy of the logo, its shape, and the school's colors for the badge or the dark tile. */
export type BoardCrest = { logo: { tiny: string; aspect: number; light: boolean } | null; theme: Identity["theme"] };

export const boardCrests = (crests: Record<string, Identity>): Record<string, BoardCrest> =>
  Object.fromEntries(
    Object.entries(crests).map(([name, c]) => [name, { logo: c.logo && { tiny: c.logo.tiny, aspect: c.logo.aspect, light: c.logo.light }, theme: c.theme }]),
  );

/** The Identity a Crest takes, from a BoardCrest: only the tiny copy is ever drawn at this size (components/crest `logoCopy`). */
export const crestIdentity = (c: BoardCrest): Identity => ({
  mascot: null,
  colors: [],
  logo: c.logo && { src: c.logo.tiny, small: c.logo.tiny, tiny: c.logo.tiny, large: c.logo.tiny, aspect: c.logo.aspect, light: c.logo.light },
  theme: c.theme,
});
