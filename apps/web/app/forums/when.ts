/** "Nov 12, 2026" in Texas time, for lists rendered on the server. */
export const when = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { timeZone: "America/Chicago", year: "numeric", month: "short", day: "numeric" });
