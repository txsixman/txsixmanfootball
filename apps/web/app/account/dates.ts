// Dates on the account page, in the site's time zone (America/Chicago), the same on the server and in the browser.

const long = new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "America/Chicago" });

/** "December 14, 2026" for an ISO timestamp; an empty string for one that is not a date. */
export const longDate = (iso: string) => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? "" : long.format(new Date(t));
};
