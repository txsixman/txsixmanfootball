// The one-click unsubscribe link in every email (ADR 0053, RFC 8058). It carries a single random token (a UUID the database made
// for that fan and kind, migration 0022) and nothing else: no address, no id, no kind. The token is the whole proof, so the
// database function that acts on it answers the same for any value. No imports, so the sender (tools/email), the site's route and
// the node tests all use this one file as it is.

const TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** The token in lower case when `value` has the shape of one (a single string), else null. Shape only: whether it matches a fan is the database's to know, and never told. */
export const unsubscribeToken = (value: unknown): string | null => (typeof value === "string" && TOKEN.test(value.toLowerCase()) ? value.toLowerCase() : null);

/** The https link for a token: `/api/email/unsubscribe` is the address a mail app POSTs to; another `path` is the page a person opens. */
export const unsubscribeUrl = (origin: string, token: string, path = "/api/email/unsubscribe") => `${origin}${path}?${new URLSearchParams({ t: token })}`;
