import { createHmac, timingSafeEqual } from "node:crypto";

// The signed one-click unsubscribe link in every email (ADR 0053, RFC 8058). The link carries the fan's user id, the kind of
// email and an HMAC-SHA256 of both under a secret only the site and the sender hold. The id is a random UUID no public
// function returns; the signature is what stops anyone who has no link from even trying one. The link holds no email address,
// and nothing about it says whose it is. Plain Node only (node:crypto), so the sender (tools/email) and the site's route use
// this one file, and the node tests run it as it is.

/** The kinds of email there are; the same names as the database's email_kind (migration 0022). */
const EMAIL_KINDS = ["game_alerts", "weekly_digest"] as const;
export type EmailKind = (typeof EMAIL_KINDS)[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const isKind = (k: unknown): k is EmailKind => typeof k === "string" && (EMAIL_KINDS as readonly string[]).includes(k);

/** base64url HMAC-SHA256 over the kind and the id. The kind is inside it, so a game-alert link cannot unsubscribe a digest. */
export const unsubscribeSignature = (secret: string, userId: string, kind: EmailKind) =>
  createHmac("sha256", secret).update(`unsubscribe\n${kind}\n${userId.toLowerCase()}`).digest("base64url");

/** The https link for a fan's emails of one kind: the page a person opens, and the address a mail app POSTs to. */
export function unsubscribeUrl(origin: string, secret: string, userId: string, kind: EmailKind, path = "/api/email/unsubscribe") {
  const query = new URLSearchParams({ u: userId.toLowerCase(), k: kind, s: unsubscribeSignature(secret, userId, kind) });
  return `${origin}${path}?${query}`;
}

/** The id and kind a link's parts name when the signature is right, else null. Constant-time, and never throws on odd input. */
export function verifyUnsubscribe(secret: string, u: unknown, k: unknown, s: unknown): { userId: string; kind: EmailKind } | null {
  if (typeof u !== "string" || typeof s !== "string" || !isKind(k) || !UUID.test(u.toLowerCase())) return null;
  const want = Buffer.from(unsubscribeSignature(secret, u, k));
  const got = Buffer.from(s);
  return got.length === want.length && timingSafeEqual(got, want) ? { userId: u.toLowerCase(), kind: k } : null;
}
