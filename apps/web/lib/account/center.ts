import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { NAME_MESSAGE, SignUpFields } from "../auth/sign-up.ts";
import { logDbFailure } from "../log-db.ts";
import { displayNameProblem } from "../moderation/names.ts";

// The Account Center's server half (ADR 0058, migration 0026). The account page, its server actions and its routes call only
// these. Each takes the request's Supabase client (getUser()'s `supabase`: the visitor's own session, never a service key) and
// answers with plain data or `{ error }`; it never throws, and logs a failed call by its SQLSTATE only (lib/log-db.ts). The database acts on auth.uid()'s own rows alone and
// checks everything again. No function here returns the birth year, a push endpoint or key, or an unsubscribe token, and no
// Supabase error text is kept: an error is one of four fixed words (the codes below are Postgres SQLSTATEs, not wording).
//
// Relative imports with their extensions, so the unit tests run this file as it is under plain node.

/** What went wrong, in the few words the page needs. `too_soon` carries `nextAt` (an ISO date); `bad_name` may carry a plain `message`. */
export type CenterError = { error: "too_soon" | "taken" | "bad_name" | "failed"; nextAt?: string; message?: string };

/** True when `value` is a CenterError (a successful answer never has an `error` key). */
export const isCenterError = (value: unknown): value is CenterError =>
  typeof value === "object" && value !== null && !Array.isArray(value) && "error" in value;

const FAILED: CenterError = { error: "failed" };

type DbError = { code?: string | null; message?: string | null; details?: string | null } | null;

type Answer = { data: unknown; error: NonNullable<DbError> | null };

/** A rename's refusals the fan is told about (too soon, taken, not allowed): answers, not failures, so not logged. */
const TOLD = new Set(["55000", "23505", "23514"]);

/** One rpc() call that never throws: a network failure is an error answer like any other. Every failure is logged by its code, except a rename's told refusals. */
async function rpc(supabase: SupabaseClient, fn: string, args: Record<string, unknown> = {}): Promise<Answer> {
  try {
    const { data, error } = await supabase.rpc(fn, args);
    if (error && !(fn === "change_display_name" && TOLD.has(error.code ?? ""))) logDbFailure("account", fn, error.code);
    return { data, error: error ?? null };
  } catch {
    logDbFailure("account", fn);
    return { data: null, error: {} };
  }
}

const NAME_MESSAGES: Record<string, string> = {
  name_reserved: "Pick a different name. That one is reserved.",
  name_not_allowed: "Pick a different name. That one is not allowed.",
};

/** Postgres's DETAIL text for a timestamptz ("2026-12-14 10:00:00.123456+00") as an ISO string, or undefined. */
function isoFromDetail(details: string | null | undefined): string | undefined {
  const m = /^(\d{4}-\d\d-\d\d)[ T](\d\d:\d\d:\d\d)(\.\d+)?(Z|[+-]\d\d(?::?\d\d)?)$/.exec((details ?? "").trim());
  if (!m) return undefined;
  const zone = m[4] === "Z" ? "Z" : m[4].length === 3 ? `${m[4]}:00` : m[4].length === 5 ? `${m[4].slice(0, 3)}:${m[4].slice(3)}` : m[4];
  const t = Date.parse(`${m[1]}T${m[2]}${m[3] ?? ""}${zone}`);
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
}

/** A rename's database error as a CenterError (change_display_name, migration 0026). Reads only the SQLSTATE and the fixed tokens in our own message. */
function nameError(error: NonNullable<DbError>): CenterError {
  const message = error.message ?? "";
  if (error.code === "55000" || message.includes("name_too_soon")) {
    const nextAt = isoFromDetail(error.details);
    return nextAt ? { error: "too_soon", nextAt } : { error: "too_soon" };
  }
  if (error.code === "23505" || message.includes("name_taken")) return { error: "taken" };
  if (error.code === "23514") {
    const token = Object.keys(NAME_MESSAGES).find((t) => message.includes(t));
    return { error: "bad_name", message: token ? NAME_MESSAGES[token] : NAME_MESSAGE };
  }
  return FAILED;
}

// ---- The account -------------------------------------------------------------------------------------------------------

export type Account = { displayName: string; joinedAt: string; nameChangedAt: string | null; nextNameChangeAt: string | null };

const AccountRow = z.object({ display_name: z.string(), joined_at: z.string(), name_changed_at: z.string().nullable(), next_name_change_at: z.string().nullable() });

/** The signed-in fan's account as the page shows it; null when sign-up is not finished. `nextNameChangeAt` is null when a change is allowed now. */
export async function getAccount(supabase: SupabaseClient): Promise<Account | null | CenterError> {
  const { data, error } = await rpc(supabase, "my_account");
  if (error) return FAILED;
  const rows = z.array(AccountRow).safeParse(data);
  if (!rows.success) return FAILED;
  const r = rows.data[0];
  return r ? { displayName: r.display_name, joinedAt: r.joined_at, nameChangedAt: r.name_changed_at, nextNameChangeAt: r.next_name_change_at } : null;
}

/**
 * Change the display name: sign-up's rules (3 to 24 characters, the word list, reserved names, unique) checked here for a quick
 * answer and again in the database, which also holds the one change per 30 days. Success: `{ nextAt }`, the ISO date the next
 * change opens. Failure: too_soon (with `nextAt`), taken, bad_name (with a plain `message`), or failed.
 */
export async function changeDisplayName(supabase: SupabaseClient, name: string): Promise<{ nextAt: string } | CenterError> {
  const fields = SignUpFields.shape.displayName.safeParse(name);
  if (!fields.success) return { error: "bad_name", message: NAME_MESSAGE };
  const problem = displayNameProblem(fields.data);
  if (problem) return { error: "bad_name", message: problem };
  const { data, error } = await rpc(supabase, "change_display_name", { p_name: fields.data });
  if (error) return nameError(error);
  const nextAt = z.string().safeParse(data);
  const t = nextAt.success ? Date.parse(nextAt.data) : Number.NaN;
  return Number.isNaN(t) ? FAILED : { nextAt: new Date(t).toISOString() };
}

// ---- Devices -------------------------------------------------------------------------------------------------------------

export type Device = { id: string; label: string; linkedAt: string; lastUsedAt: string };

const DeviceRow = z.object({ id: z.string(), label: z.string(), linked_at: z.string(), last_used_at: z.string() });

/** The account's linked browsers, most recently used first. No endpoint or key: only a device id, a label and two dates. */
export async function listDevices(supabase: SupabaseClient): Promise<Device[] | CenterError> {
  const { data, error } = await rpc(supabase, "my_devices");
  if (error) return FAILED;
  const rows = z.array(DeviceRow).safeParse(data);
  return rows.success ? rows.data.map((r) => ({ id: r.id, label: r.label, linkedAt: r.linked_at, lastUsedAt: r.last_used_at })) : FAILED;
}

/** The device id of the browser holding `endpoint`, or null when it is not linked to this account. The endpoint is never sent back. */
export async function thisDevice(supabase: SupabaseClient, endpoint: string): Promise<{ id: string | null } | CenterError> {
  const { data, error } = await rpc(supabase, "this_device", { p_endpoint: endpoint });
  if (error) return FAILED;
  const id = z.string().nullable().safeParse(data);
  return id.success ? { id: id.data } : FAILED;
}

/** Remove one of my devices (alerts to that browser stop). Another account's id, or an unknown one, changes nothing and still answers ok. */
export async function removeDevice(supabase: SupabaseClient, id: string): Promise<{ ok: true } | CenterError> {
  const { error } = await rpc(supabase, "remove_my_device", { p_id: id });
  return error ? FAILED : { ok: true };
}

/** Remove every device of the account; says how many went. The first step of "sign out of all devices". */
export async function removeAllDevices(supabase: SupabaseClient): Promise<{ removed: number } | CenterError> {
  const { data, error } = await rpc(supabase, "remove_all_my_devices");
  if (error) return FAILED;
  const n = z.number().int().nonnegative().safeParse(data);
  return n.success ? { removed: n.data } : FAILED;
}

// ---- Per-team mutes on one browser -------------------------------------------------------------------------------------

const Slugs = z.array(z.string());

/** The teams muted on the browser holding `endpoint` (empty when none, or when it is not linked to this account). */
export async function getPushMutes(supabase: SupabaseClient, endpoint: string): Promise<string[] | CenterError> {
  const { data, error } = await rpc(supabase, "my_push_mutes", { p_endpoint: endpoint });
  if (error) return FAILED;
  const slugs = Slugs.nullable().safeParse(data);
  return slugs.success ? (slugs.data ?? []) : FAILED;
}

/** Mute or unmute one team on the browser holding `endpoint`; answers the browser's muted teams afterwards. `failed` also when the browser is not linked to this account. */
export async function setPushMute(supabase: SupabaseClient, endpoint: string, slug: string, muted: boolean): Promise<string[] | CenterError> {
  const { data, error } = await rpc(supabase, "set_push_mute", { p_endpoint: endpoint, p_slug: slug, p_muted: muted });
  if (error) return FAILED;
  const slugs = Slugs.safeParse(data);
  return slugs.success ? slugs.data : FAILED;
}

// ---- Download my data ---------------------------------------------------------------------------------------------------

/** The part of Supabase's user the export needs. */
export type AuthUser = { email?: string | null; app_metadata?: { provider?: unknown; providers?: unknown } | null; identities?: { provider?: unknown }[] | null };

/** How the person signs in ("email", "google"): the providers Supabase Auth lists for them, each once. */
export function signInProviders(user: AuthUser): string[] {
  const found = new Set<string>();
  const add = (p: unknown) => {
    if (typeof p === "string" && /^[a-z0-9_-]{1,30}$/.test(p)) found.add(p);
  };
  const meta = user.app_metadata;
  const listed = meta?.providers;
  if (Array.isArray(listed)) listed.forEach(add);
  add(meta?.provider);
  for (const i of user.identities ?? []) add(i?.provider);
  return [...found].sort();
}

/**
 * Everything the account holds that is the person's to read: the database's own export (migration 0026: the profile, follows,
 * devices, email settings and posts; never the birth year, an endpoint, a key or a token) with the person's own email and sign-in
 * providers from Supabase Auth added to `account`. Pass the verified user from getUser(); without it Supabase is asked.
 */
export async function exportMyData(supabase: SupabaseClient, user?: AuthUser): Promise<Record<string, unknown> | CenterError> {
  const { data, error } = await rpc(supabase, "export_my_data");
  if (error) return FAILED;
  const doc = z.record(z.string(), z.unknown()).safeParse(data);
  const account = z.record(z.string(), z.unknown()).safeParse(doc.success ? doc.data.account : null);
  if (!doc.success || !account.success) return FAILED;
  let who = user;
  if (!who) {
    try {
      const found = await supabase.auth.getUser();
      if (found.error || !found.data.user) return FAILED;
      who = found.data.user;
    } catch {
      return FAILED;
    }
  }
  return { ...doc.data, account: { ...account.data, email: who.email ?? null, sign_in_providers: signInProviders(who) } };
}

// ---- My activity --------------------------------------------------------------------------------------------------------

export type ActivityItem = { kind: "comment" | "thread" | "reply" | "score_report"; id: string; excerpt: string; createdAt: string; href: string | null };

const ActivityRow = z.object({
  kind: z.enum(["comment", "thread", "reply", "score_report"]),
  id: z.string(),
  body_excerpt: z.string(),
  created_at: z.string(),
  href: z.string().nullable(),
});

/** The person's own comments, forum threads and replies, and score reports, newest first (what the public could see of them). The page hides the section while FAN_POSTS is off. */
export async function myActivity(supabase: SupabaseClient, limit = 20): Promise<ActivityItem[] | CenterError> {
  const { data, error } = await rpc(supabase, "my_activity", { p_limit: limit });
  if (error) return FAILED;
  const rows = z.array(ActivityRow).safeParse(data);
  return rows.success ? rows.data.map((r) => ({ kind: r.kind, id: r.id, excerpt: r.body_excerpt, createdAt: r.created_at, href: r.href })) : FAILED;
}

// ---- Device labels --------------------------------------------------------------------------------------------------------

/**
 * A short label for a browser, from its User-Agent header: "Chrome on iPhone", "Safari on Mac", "Firefox on Windows". Only this
 * label is ever stored, never the User-Agent itself. A browser that is not one of Chrome, Safari, Firefox, Edge or Samsung Internet
 * is "A browser" (Opera, Brave and the rest: the label is a convenience, not a fingerprint); a known one on an unknown system is just
 * its name. At most 40 characters, letters and spaces only (the database accepts nothing else).
 */
export function deviceLabel(userAgent: string): string {
  const ua = typeof userAgent === "string" ? userAgent.slice(0, 1000) : "";
  const has = (re: RegExp) => re.test(ua);
  let browser: string | null = null;
  if (has(/\b(EdgA|EdgiOS|Edg|Edge)\//)) browser = "Edge";
  else if (has(/\b(OPR|OPT|OPiOS|Opera|Vivaldi|DuckDuckGo|UCBrowser|YaBrowser|Brave|Whale|MiuiBrowser|HuaweiBrowser)\b/)) browser = null;
  else if (has(/\bSamsungBrowser\//)) browser = "Samsung Internet";
  else if (has(/\b(FxiOS|Firefox)\//)) browser = "Firefox";
  else if (has(/\b(CriOS|Chrome)\//)) browser = "Chrome";
  else if (has(/\bVersion\/[\d.]+.*\bSafari\//) && !has(/\bAndroid\b/)) browser = "Safari";
  if (!browser) return "A browser";
  let system: string | null = null;
  if (has(/\biPhone\b/)) system = "iPhone";
  else if (has(/\biPad\b/)) system = "iPad";
  else if (has(/\bAndroid\b/)) system = "Android";
  else if (has(/\bCrOS\b/)) system = "ChromeOS";
  else if (has(/\bWindows\b/)) system = "Windows";
  else if (has(/\b(Macintosh|Mac OS X)\b/)) system = "Mac";
  else if (has(/\b(Linux|X11)\b/)) system = "Linux";
  return (system ? `${browser} on ${system}` : browser).slice(0, 40);
}
