/**
 * One server log line for a fan route's database call that failed, so no failure is silent: the area, the function and the
 * SQLSTATE only, never a message, value, id, endpoint or email. The owner reads them with `vercel logs --environment
 * production` (docs/fan-accounts.md, "Watch the first night"). A refusal the fan caused and is told about (a name taken, the
 * 100-team cap) is not logged.
 */
export function logDbFailure(area: string, fn: string, code?: string | null): void {
  console.error(`${area}: database call failed`, fn, code || "unknown");
}
