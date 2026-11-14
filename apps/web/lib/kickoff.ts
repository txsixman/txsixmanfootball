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

/** True when any of these games (with no final) is inside its in-progress window at `now`. A game with no kickoff time is
 * never in progress, so a page of such games asks for nothing: the live read starts only on a time we know. */
export const anyInProgress = (games: { date: string; kickoff?: string }[], now: Date) => games.some((g) => kickoffState(g, now).kind === "in-progress");

export type NightGroupKey = "in-progress" | "up-next" | "final";
type NightGame = { date: string; kickoff?: string; state: "later" | "final" | "forfeit" };

const GROUPS: { key: NightGroupKey; label: string }[] = [
  { key: "in-progress", label: "In progress" },
  { key: "up-next", label: "Up next" },
  { key: "final", label: "Final" },
];
const kickoffMs = (g: { kickoff?: string }) => (g.kickoff ? Date.parse(g.kickoff) : NaN);

/**
 * One organization's games for the Tonight page at `now`, in groups, empty ones left out: "In progress" (earliest kickoff
 * first), "Up next" (earliest first, no time last), "Final" (latest first, no time last). A game with a final or a forfeit is
 * always Final; a game with no final is in progress inside its window, up next before it or with no time listed, and Final
 * once the window has passed with no score (its row still says "Score not reported yet"). `now` null (the server, and the
 * first render in the browser) puts every game with no final under "Up next", so the first paint is the same everywhere.
 */
export function groupTonight<T extends NightGame>(games: T[], now: Date | null): { key: NightGroupKey; label: string; games: T[] }[] {
  const keyOf = (g: T): NightGroupKey => {
    if (g.state !== "later") return "final";
    const kind = now ? kickoffState(g, now).kind : "starts";
    return kind === "in-progress" ? "in-progress" : kind === "awaiting" ? "final" : "up-next";
  };
  return GROUPS.map(({ key, label }) => {
    const sign = key === "final" ? -1 : 1;
    const inGroup = games.filter((g) => keyOf(g) === key);
    // Array.prototype.sort is stable: games with the same (or no) time keep the order they came in.
    const sorted = [...inGroup].sort((a, b) => {
      const [x, y] = [kickoffMs(a), kickoffMs(b)];
      if (Number.isNaN(x) || Number.isNaN(y)) return Number.isNaN(x) === Number.isNaN(y) ? 0 : Number.isNaN(x) ? 1 : -1;
      return sign * (x - y);
    });
    return { key, label, games: sorted };
  }).filter((group) => group.games.length);
}
