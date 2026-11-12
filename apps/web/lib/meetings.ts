// Shared by the matchup page (server) and its picker (client), so it imports nothing.
/** A past game between two teams: date, home team's slug, home score, away score, and true for a forfeit. */
export type Meeting = [date: string, home: string, homeScore: number, awayScore: number, forfeit?: boolean];

/** One key per pair of teams, whichever is named first. */
export const pairKey = (x: string, y: string) => [x, y].sort().join("|");
