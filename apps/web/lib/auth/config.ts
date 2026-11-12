// Sign-in settings, read from the server's environment. No imports, so the node tests run it as it is.
//
// NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are public by design (the anon key only opens what row-level
// security allows). ADMIN_USER_ID is server-only: the one Supabase user id the admin console lets in.

export type AuthEnv = { url: string; anonKey: string };

/** The Supabase project's address and public key, or null when either is missing (sign-in then fails closed). */
export function authEnv(env: Record<string, string | undefined> = process.env): AuthEnv | null {
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey || !/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(url)) return null;
  return { url, anonKey };
}

/**
 * Whether fan accounts exist at all. FAN_SIGNIN must be exactly "on", nothing trimmed (server-only, read at request time, so flipping it in
 * Vercel and redeploying is enough; never a NEXT_PUBLIC build-time constant). Off, the default: no "Sign in" link, no
 * Google button, no sign-up step, no account follows; /sign-in is only the email form for existing accounts (the admin).
 */
export function fanSignIn(env: Record<string, string | undefined> = process.env): boolean {
  return env.FAN_SIGNIN === "on";
}

/**
 * Whether the emailed sign-in link may make a NEW account. FAN_EMAIL_SIGNIN must be exactly "on" (server-only, set once the
 * project's own email sender works: Supabase's built-in sender allows about two emails an hour). Anything else, or nothing,
 * keeps the email form for existing accounts only (it is how the admin signs in). "Continue with Google" is never behind
 * this: Google sign-up is always open. Either way a new account lands on /account/welcome first.
 */
export function fanEmailSignIn(env: Record<string, string | undefined> = process.env): boolean {
  return env.FAN_EMAIL_SIGNIN?.trim() === "on";
}

/** The emailed link makes new accounts only when fan sign-in is on AND its email sign-up is on. */
export const emailMayCreateUsers = (env: Record<string, string | undefined> = process.env) => fanSignIn(env) && fanEmailSignIn(env);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** The admin's Supabase user id (lowercase), or null when missing or not a UUID, which closes the console. */
export function adminUserId(env: Record<string, string | undefined> = process.env): string | null {
  const id = env.ADMIN_USER_ID?.trim().toLowerCase();
  return id && UUID.test(id) ? id : null;
}

/**
 * How the auth cookies are set. @supabase/ssr's default leaves httpOnly off so a browser client can read them; this site
 * has no browser client (every Supabase call is on the server), so they are httpOnly, Secure in production (browsers
 * treat localhost as secure, so dev works too) and SameSite=Lax. Lax still lets the magic-link click (a top-level GET)
 * carry them, and keeps them off cross-site POSTs. They last 30 days (@supabase/ssr's own default is 400), so a lost
 * laptop's session ages out; the token inside also expires and is refreshed by the proxy on each visit.
 */
export const authCookieOptions = (production = process.env.NODE_ENV === "production") =>
  ({ path: "/", httpOnly: true, secure: production, sameSite: "lax", maxAge: 60 * 60 * 24 * 30 }) as const;

/** The same, laid over whatever options @supabase/ssr chose (this decides the safety flags and the lifetime). */
export const hardenCookie = <T extends object>(options: T) => ({ ...options, ...authCookieOptions() });

/**
 * A local path to go to after sign-in, or `fallback`. Only a plain path on this site: it must start with one slash, and
 * not `//host`, `/\host`, a scheme, or a control character, so a crafted link can never send a signed-in person elsewhere.
 */
export function safeNext(raw: unknown, fallback = "/"): string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 200) return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return fallback;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(raw)) return fallback;
  return raw;
}

/** This site's own address for a sign-in link: localhost in development, else the real domain, never a request's say-so. */
export function siteOrigin(host: string | null | undefined): string {
  const h = (host ?? "").toLowerCase();
  if (/^(localhost|127\.0\.0\.1)(:\d{1,5})?$/.test(h)) return `http://${h}`;
  return "https://txsixmanfootball.com";
}

/** Holds where to go after sign-in while the emailed link is on its way (the redirect URL Supabase accepts is exact, so it cannot carry it). */
export const NEXT_COOKIE = "auth-next";
