/**
 * Between game nights the scoreboard lists this week's games before last week's finals, once the next game day is nearer than
 * the last one (app/scores/board.tsx). Whether it is, depends on the clock, and the page is static: so the page is always built
 * with finals first, and this decides the order BEFORE THE FIRST PAINT. A small script (`upcomingFirstScript`) runs as the board
 * starts and sets `data-upcoming-first` on <html>; CSS `order` does the rest, so nothing moves when the page's own script loads
 * (ADR 0103). The board runs the same function again on the client (when it shows, as the clock moves, and when an organization or a
 * search changes the games it lists).
 *
 * Self-contained on purpose (no imports, no outside names): its source text is the inline script.
 *
 * `lastDay`: the date of the latest final listed ("YYYY-MM-DD", "" for none). `dates`: the dates of the games still to play, sorted.
 */
export function upcomingFirstAt(nowMs: number, lastDay: string, dates: string[]): boolean {
  const noon = (day: string) => Date.parse(`${day}T12:00:00-06:00`);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(nowMs);
  const next = dates.find((d) => d >= today);
  return !!lastDay && !!next && noon(next) - nowMs < nowMs - noon(lastDay);
}

/** The inline script for the board: sets or clears the attribute for these games, right now. */
export function upcomingFirstScript(lastDay: string, dates: string[]): string {
  return `(${upcomingFirstAt.toString()})`.concat(`(Date.now(),${JSON.stringify(lastDay)},${JSON.stringify(dates)})?document.documentElement.setAttribute("data-upcoming-first",""):document.documentElement.removeAttribute("data-upcoming-first")`);
}
