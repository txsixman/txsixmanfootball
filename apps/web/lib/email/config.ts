// Email alerts' settings, read from the server's environment. No imports, so the node tests run it as it is.

/**
 * Whether the account page offers email alerts at all. EMAIL_ALERTS must be exactly "on" (server-only, read per request, as
 * FAN_SIGNIN is). Off, the default: no Email alerts block, and the save route answers 404. Unsubscribing always works, whatever
 * this says: a link in an email already sent must never stop working. (Sending has its own switch: the repo variable
 * EMAIL_ALERTS in .github/workflows/email-alerts.yml.)
 */
export const emailAlertsOn = (env: Record<string, string | undefined> = process.env) => env.EMAIL_ALERTS === "on";
