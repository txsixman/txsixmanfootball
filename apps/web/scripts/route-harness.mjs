// What the route tests share (fan-routes.test.mjs, public-reads.test.mjs): the site's route handlers run as they are,
// against the real migrations on PGlite (packages/db/test's setup). Only Supabase's transport is replaced: a client whose
// rpc() calls the SQL function by its argument NAMES, as PostgREST does, as the role and auth.uid() the session gives,
// and whose auth.getUser() answers for the session the test chose. So a handler that sends an argument the SQL does not
// have fails as it would in production (PGRST202), every refusal comes from the database's own rules, and what a page
// gets back is checked. Import this before any route: it sets up module resolution first.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { ADMIN, sudo } from "../../../packages/db/test/posts-helpers.mjs";

// Module resolution the way the site's bundler does it: "@/x" is apps/web/x, a path without an extension is a .ts file,
// next/server is next/server.js. Three modules are replaced: next/headers (no request scope outside Next), and the two
// ways the site makes a Supabase client, @supabase/ssr's createServerClient (a visitor's session) and
// @supabase/supabase-js's createClient (the public reads), which hand back the test's clients. lib/auth/server.ts and
// lib/posts/api.ts run as they are.
const web = new URL("../", import.meta.url);
const stub = (src) => `data:text/javascript,${encodeURIComponent(src)}`;
const STUBS = {
  "next/headers": stub("export const cookies = async () => ({ getAll: () => [], set() {} });"),
  "@supabase/ssr": stub("export const createServerClient = () => globalThis.__testSupabase();"),
  "@supabase/supabase-js": stub("export const createClient = () => globalThis.__testPublic();"),
};
registerHooks({
  resolve(specifier, context, next) {
    if (STUBS[specifier]) return { url: STUBS[specifier], shortCircuit: true };
    const spec = specifier.startsWith("@/") ? new URL(specifier.slice(2), web).href : specifier;
    try {
      return next(spec, context);
    } catch (error) {
      if (error?.code !== "ERR_MODULE_NOT_FOUND" && error?.code !== "ERR_UNSUPPORTED_DIR_IMPORT") throw error;
      for (const ext of [".ts", ".js", "/index.ts"]) {
        try {
          return next(spec + ext, context);
        } catch {
          // try the next one
        }
      }
      throw error;
    }
  },
});

process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
process.env.ADMIN_USER_ID = ADMIN;

const { NextRequest } = await import("next/server");
/** A route module under app/api, e.g. route("fan/comments"). */
export const route = async (p) => import(new URL(`../app/api/${p}/route.ts`, import.meta.url).href);

// --- The fake Supabase client -------------------------------------------------------------------------------------

let d;
/** The database every rpc() runs on. */
export const useDb = (database) => {
  d = database;
};
let queue = Promise.resolve();
/** One database call at a time: each one sets the role and auth.uid() for itself (PGlite has one connection). */
export const serial = (fn) => {
  const run = queue.then(fn);
  queue = run.catch(() => {});
  return run;
};
const json = (value) => JSON.parse(JSON.stringify(value, (_, v) => (typeof v === "bigint" ? Number(v) : v)));
/** Every rpc() the handlers made, by function name and argument names, for the shape checks. */
export const calls = [];
/** The argument values of each call, in the same order as `calls`. */
export const sent = [];

/** PostgREST's rpc: find the public function whose input arguments match the names sent, call it by name, as the session's role. */
export async function rpc(sub, fn, args = {}) {
  calls.push({ fn, args: Object.keys(args).sort() });
  sent.push(args);
  return serial(async () => {
    const names = Object.keys(args);
    const { rows } = await d.query(
      `select p.proretset as set, t.typtype, p.prorettype = 'void'::regtype as void, p.pronargs, p.pronargdefaults,
              coalesce(p.proargnames, '{}') as argnames, p.proargmodes::text[] as modes
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_type t on t.oid = p.prorettype
        where n.nspname = 'public' and p.proname = $1`,
      [fn],
    );
    const fit = rows.find((r) => {
      const inputs = r.argnames.filter((_, i) => !r.modes || ["i", "b", "v"].includes(r.modes[i]));
      const required = inputs.slice(0, r.pronargs - r.pronargdefaults);
      return names.every((n) => inputs.includes(n)) && required.every((n) => names.includes(n));
    });
    if (!fit) {
      return { data: null, error: { code: "PGRST202", message: `Could not find the function public.${fn}(${names.join(", ")}) in the schema cache` } };
    }
    const call = `public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(", ")})`;
    const sql = fit.set || fit.typtype === "c" ? `select * from ${call}` : `select ${call} as v`;
    await d.exec(`reset role; select set_config('request.jwt.claim.sub', '${sub ?? ""}', false); set role ${sub ? "authenticated" : "anon"}`);
    try {
      const result = await d.query(sql, Object.values(args));
      if (fit.void) return { data: null, error: null };
      if (fit.set) return { data: json(result.rows), error: null };
      return { data: json(fit.typtype === "c" ? result.rows[0] : result.rows[0].v), error: null };
    } catch (e) {
      return { data: null, error: { code: e.code, message: e.message, details: e.detail ?? null, hint: e.hint ?? null } };
    } finally {
      await d.exec("reset role");
    }
  });
}

/** A client for one session: `sub` signed in, null signed out (anon). `fail`: every rpc answers with that error instead. */
export const client = (sub, { fail } = {}) => ({
  auth: {
    getUser: async () => (sub ? { data: { user: { id: sub } }, error: null } : { data: { user: null }, error: { name: "AuthSessionMissingError", message: "Auth session missing!", status: 400 } }),
  },
  rpc: (fn, args) => (fail ? Promise.resolve({ data: null, error: fail }) : rpc(sub, fn, args)),
});
let current = client(null);
let anon = client(null);
globalThis.__testSupabase = () => current;
globalThis.__testPublic = () => anon;
/** The visitor's session client: signed in as `sub`. */
export const signIn = (sub, opts) => (current = client(sub, opts));
/** No session, and the public reads back to an ordinary anon client. */
export const signOut = () => {
  current = client(null);
  anon = client(null);
};
/** The current session's client. */
export const session = () => current;
/** The public reads' anon client: `fail` makes every call answer with that error. */
export const setPublic = (opts) => (anon = client(null, opts));
/** Runs `sql` as the superuser, between the handlers' calls. */
export const sudoRows = (sql, p) => serial(async () => (await sudo(d, sql, p)).rows);

// --- Requests ----------------------------------------------------------------------------------------------------

const HOST = "localhost:3000";
export const ORIGIN = `http://${HOST}`;
export function request(path, { method = "POST", body, origin = ORIGIN, type = "application/json", cookie, referer, raw } = {}) {
  const headers = { host: HOST };
  if (origin) headers.origin = origin;
  if (type) headers["content-type"] = type;
  if (cookie) headers.cookie = cookie;
  if (referer) headers.referer = referer;
  const payload = raw ?? (body === undefined ? undefined : JSON.stringify(body));
  return new NextRequest(`${ORIGIN}${path}`, { method, headers, body: method === "GET" ? undefined : payload });
}
export const params = (id) => ({ params: Promise.resolve({ id }) });
export async function read(res) {
  const text = await res.text();
  return { status: res.status, cache: res.headers.get("cache-control"), body: text ? JSON.parse(text) : null, text };
}
/** Nothing of the database's own wording, a user id or an SQL state reaches the page. */
export function noInternals(r) {
  assert.doesNotMatch(r.text, /permission|denied|function|schema|relation|select|public\.|\b[0-9A-Z]{5}\b|aaaaaaaa-|PGRST/);
}
