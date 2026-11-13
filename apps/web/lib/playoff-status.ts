// What a bracket game's status line says, from the game's date and score and today's date. No imports: pure, so the
// tests run it as it is. The data holds dates, not kickoff times, and scores come from a robot that reads every 30
// minutes on playoff Friday nights (ADR 0015): a game on its own date with no score is "tonight", never "in progress".
// A robot-read score is unconfirmed (ADR 0004): it is shown, marked, and names no winner.

export type StatusInput = { date: string; homeScore?: number; forfeit: boolean; confirmed: boolean };
export type GameStatus = { kind: "scheduled" | "tonight" | "awaiting" | "reported" | "final" | "forfeit"; label: string; unconfirmed: boolean };

/** `today` is a Central-time date, "YYYY-MM-DD" (`centralClock`). */
export function gameStatus(g: StatusInput, today: string): GameStatus {
  if (g.forfeit) return { kind: "forfeit", label: "Forfeit", unconfirmed: false };
  if (g.homeScore != null) {
    return g.confirmed
      ? { kind: "final", label: "Final", unconfirmed: false }
      : { kind: "reported", label: g.date === today ? "Reported tonight" : "Score reported", unconfirmed: true };
  }
  if (g.date > today) return { kind: "scheduled", label: "Not yet played", unconfirmed: false };
  if (g.date === today) return { kind: "tonight", label: "Tonight, no score yet", unconfirmed: false };
  return { kind: "awaiting", label: "Score not reported yet", unconfirmed: false };
}

/** Today's date and a readable time in Central, the zone every Texas playoff game is scheduled in. */
export function centralClock(now = new Date()): { date: string; label: string } {
  const at = (opts: Intl.DateTimeFormatOptions, locale = "en-US") => now.toLocaleString(locale, { timeZone: "America/Chicago", ...opts });
  return {
    date: at({ year: "numeric", month: "2-digit", day: "2-digit" }, "en-CA"),
    label: `${at({ weekday: "short", month: "short", day: "numeric" })}, ${at({ hour: "numeric", minute: "2-digit" })} CT`,
  };
}

type RoundInput = { round: string; games: { date: string; homeScore?: number }[] };

/**
 * The round a fan wants first: the one with a game today; else the earliest with a game still to play; else the last.
 * (A stray unplayed game in an old round does not pull the page back, because a later round with games to play wins.)
 */
export function currentRound<R extends RoundInput>(rounds: R[], today: string): R | undefined {
  const open = rounds.filter((r) => r.games.some((g) => g.homeScore == null));
  return (
    rounds.find((r) => r.games.some((g) => g.date === today)) ??
    open.find((r) => r.games.some((g) => g.date > today)) ??
    open[0] ??
    rounds.at(-1)
  );
}
