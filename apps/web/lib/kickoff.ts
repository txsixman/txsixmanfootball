// A game's kickoff and what it is at the moment of viewing (ADR 0036). Pure, no imports: the node tests run it as it is,
// and the browser runs it every minute (app/kickoff-status.tsx), so a static page is never stale. Only for a game with no
// final: a final shows its score instead. Nothing here names a winner or a leader.

/** How long after kickoff a game with no final still reads "In progress". After that it waits on its score. */
export const IN_PROGRESS_MS = 4 * 3600_000;

export type KickoffState = {
  kind: "starts" | "in-progress" | "awaiting" | "unlisted";
  /** "Starts 7:00 PM CT", "In progress", "Score not reported yet", "Time not listed". */
  label: string;
  /** The same in a narrow cell: "7:00 PM CT", "In progress", "No score yet", "Time not listed". */
  short: string;
};

/** "7:00 PM CT": the kickoff in Central time, where every Texas game is played. */
export function kickoffTime(utc: string): string {
  const t = new Date(utc).toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" });
  return `${t} CT`;
}

/** Today's date in Central, "YYYY-MM-DD". */
const centralDay = (now: Date) => now.toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

/** What a game with no final is at `now`: from its kickoff (UTC) when known, else from its date alone. */
export function kickoffState(game: { date: string; kickoff?: string }, now: Date): KickoffState {
  const at = game.kickoff ? Date.parse(game.kickoff) : NaN;
  const awaiting: KickoffState = { kind: "awaiting", label: "Score not reported yet", short: "No score yet" };
  if (Number.isNaN(at)) {
    return game.date < centralDay(now) ? awaiting : { kind: "unlisted", label: "Time not listed", short: "Time not listed" };
  }
  const time = kickoffTime(game.kickoff!);
  if (now.getTime() < at) return { kind: "starts", label: `Starts ${time}`, short: time };
  if (now.getTime() < at + IN_PROGRESS_MS) return { kind: "in-progress", label: "In progress", short: "In progress" };
  return awaiting;
}
