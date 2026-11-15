// One email through Resend's HTTP API (https://resend.com/docs/api-reference/emails/send-email), with an Idempotency-Key so a
// retry inside 24 hours cannot send twice. Returns only a class of outcome, never Resend's text: an error body can quote the
// address it refused, and nothing here may log an address (ADR 0053).
import { createHash } from "node:crypto";

export const RESEND_URL = "https://api.resend.com/emails";

/** A key Resend sees instead of the user id and item: the same email always has the same key, and it names no one. */
export const idempotencyKey = (userId, kind, item) => createHash("sha256").update(`${userId}|${kind}|${item}`).digest("hex");

/**
 * Sends one email. `outcome`: "sent"; "rejected" (a 4xx the service will answer the same way again: a refused address);
 * "slow" (429: stop this run, the rest wait for the next); "stop" (401 or 403: the key or the sending domain is wrong, which is
 * every email's problem, so the run stops and fails); "retry" (a 5xx, a conflict, a timeout, no answer: tried again next run).
 * `status` is the HTTP status, or 0 when there was none.
 */
export async function sendEmail({ fetch: doFetch = fetch, apiKey, from, to, subject, text, html, headers, key }) {
  let res;
  try {
    res = await doFetch(RESEND_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify({ from, to: [to], subject, text, html, headers }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return { outcome: "retry", status: 0 };
  }
  if (res.ok) return { outcome: "sent", status: res.status };
  if (res.status === 429) return { outcome: "slow", status: 429 };
  if (res.status === 401 || res.status === 403) return { outcome: "stop", status: res.status };
  if (res.status === 408 || res.status === 409 || res.status >= 500) return { outcome: "retry", status: res.status };
  return { outcome: "rejected", status: res.status };
}
