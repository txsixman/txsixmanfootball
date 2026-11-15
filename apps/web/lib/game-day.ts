/** "Fri, Nov 20": a game's Central date (YYYY-MM-DD) as a short day, read at noon UTC so no time zone moves it. */
export const gameDay = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
