// Whether game alerts (kickoff, final, next-round pairing) are shown on the site: FAN_PUSH_ALERTS must be exactly "on" once
// trimmed (server-only, read at request time, never NEXT_PUBLIC). Off, the default: no toggle and no iOS note anywhere. The
// database has its own switch (site_switch `push_alerts`, migration 0031) that the sender reads. No imports, so node tests run it as it is.
export function pushAlertsOn(env: Record<string, string | undefined> = process.env): boolean {
  return env.FAN_PUSH_ALERTS?.trim() === "on";
}
