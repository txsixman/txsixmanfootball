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

/** Where a game with no kickoff time may be under way: its game date's evening in Central, 5:00 PM to midnight. */
const EVENING_FROM_HOUR = 17;
const centralHour = (now: Date) => Number(now.toLocaleString("en-US", { timeZone: "America/Chicago", hour: "numeric", hourCycle: "h23" }));

/** True when any of these games (with no final) may be under way at `now`, so the page reads live scores: from kickoff to
 * 4 hours after when the kickoff is known; with no kickoff time, through its game date's evening (5:00 PM to midnight
 * Central), so its live score still shows. At any other time a page asks for nothing. */
export const anyInProgress = (games: { date: string; kickoff?: string }[], now: Date) =>
  games.some((g) =>
    Number.isNaN(g.kickoff ? Date.parse(g.kickoff) : NaN)
      ? g.date === centralDay(now) && centralHour(now) >= EVENING_FROM_HOUR
      : kickoffState(g, now).kind === "in-progress",
  );

export type NightGroupKey = "in-progress" | "up-next" | "final" | "awaiting";
/** `underWay`: the live read has a score for it now (ADR 0039), so it is in progress whatever its kickoff says. */
type NightGame = { date: string; kickoff?: string; state: "later" | "final" | "forfeit"; underWay?: boolean };

const GROUPS: { key: NightGroupKey; label: string }[] = [
  { key: "in-progress", label: "In progress" },
  { key: "up-next", label: "Up next" },
  { key: "final", label: "Final" },
  // Over four hours past kickoff with no final: not "Final" (no score is in), so a group of its own, last.
  { key: "awaiting", label: "Score not reported yet" },
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
    if (g.underWay) return "in-progress";
    const kind = now ? kickoffState(g, now).kind : "starts";
    return kind === "in-progress" ? "in-progress" : kind === "awaiting" ? "awaiting" : "up-next";
  };
  return GROUPS.map(({ key, label }) => {
    const sign = key === "up-next" || key === "in-progress" ? 1 : -1;
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

/**
 * What a game page says in the place its live score goes, while it has no live score (ADR 0087). Never blank, never a guess:
 * before kickoff it is not started, inside the window it is in progress with no score yet, past the window the score has not
 * come in, and a game with no listed time says so. `now` null (the server, the first render) reads as before kickoff.
 */
export function pendingNote(game: { date: string; kickoff?: string }, now: Date | null): { title: string; detail: string } {
  const time = game.kickoff && !Number.isNaN(Date.parse(game.kickoff)) ? kickoffTime(game.kickoff) : null;
  const state = now ? kickoffState(game, now) : null;
  if (state?.kind === "in-progress") return { title: "In progress", detail: "No live score yet. This page checks every minute." };
  if (state?.kind === "awaiting") return { title: "Score not reported yet", detail: `${time ? `Kickoff was ${time}. ` : ""}No score has come in. Reload later to check.` };
  if (!time) return { title: "Kickoff time not listed", detail: "A live score shows here once the game is under way." };
  return { title: "Not started", detail: `Kickoff ${time}. Score shows here once it starts.` };
}

/** The rank of a night group, so organizations with a game in progress come first, then those with games still to come,
 * then those with only finals (ADR 0087). Lower is first; ties keep the site's own order. */
const GROUP_RANK: Record<NightGroupKey, number> = { "in-progress": 0, "up-next": 1, awaiting: 2, final: 3 };
export const orgRank = (groups: { key: NightGroupKey }[]) => Math.min(...groups.map((g) => GROUP_RANK[g.key]), 9);
