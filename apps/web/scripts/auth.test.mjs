// The shared sign-in foundation's plain-code parts (lib/auth, lib/never-cached.ts, sw.ts, proxy.ts).   node --test apps/web/scripts/
import assert from "node:assert/strict";
import { test } from "node:test";
import { adminUserId, authCookieOptions, authEnv, emailMayCreateUsers, fanEmailSignIn, fanSignIn, hardenCookie, safeNext, siteOrigin } from "../lib/auth/config.ts";
import { currentYear, decideSignUp } from "../lib/auth/age.ts";
import { displayNameProblem } from "../lib/moderation/names.ts";
import { isNeverCached, NEVER_CACHED } from "../lib/never-cached.ts";

// ---- sign-in -------------------------------------------------------------------------------------------------------

test("sign-in goes only to a path on this site", () => {
  assert.equal(safeNext("/admin"), "/admin");
  assert.equal(safeNext("/account/profile?x=1"), "/account/profile?x=1");
  for (const bad of ["//evil.test", "/\\evil.test", "https://evil.test", "evil.test", "javascript:alert(1)", "", undefined, null, 5, "/a\nb", "/" + "a".repeat(300)]) {
    assert.equal(safeNext(bad), "/", String(bad));
  }
  assert.equal(safeNext("//evil.test", "/admin"), "/admin");
});

test("the sign-in link always points at this site, never at what a request claims", () => {
  assert.equal(siteOrigin("localhost:3061"), "http://localhost:3061");
  assert.equal(siteOrigin("127.0.0.1:3011"), "http://127.0.0.1:3011");
  for (const host of ["evil.test", "localhost.evil.test", "txsixmanfootball.com", "evil.test:80@localhost", "", null, undefined]) assert.equal(siteOrigin(host), "https://txsixmanfootball.com", String(host));
});

test("sign-in and the console fail closed without their settings", () => {
  assert.equal(authEnv({}), null);
  assert.equal(authEnv({ NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co" }), null);
  assert.equal(authEnv({ NEXT_PUBLIC_SUPABASE_URL: "https://evil.test", NEXT_PUBLIC_SUPABASE_ANON_KEY: "k" }), null);
  assert.deepEqual(authEnv({ NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "k" }), { url: "https://abc.supabase.co", anonKey: "k" });
  assert.equal(adminUserId({}), null);
  assert.equal(adminUserId({ ADMIN_USER_ID: "not-a-uuid" }), null);
  assert.equal(adminUserId({ ADMIN_USER_ID: "  11111111-1111-4111-8111-111111111111 " }), "11111111-1111-4111-8111-111111111111");
  assert.equal(adminUserId({ ADMIN_USER_ID: "11111111-1111-4111-8111-11111111111G" }), null);
});

test("the auth cookies are httpOnly, SameSite=Lax and Secure in production, whatever the library asked for", () => {
  assert.deepEqual(authCookieOptions(true), { path: "/", httpOnly: true, secure: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 30 });
  assert.equal(authCookieOptions(false).httpOnly, true);
  const hardened = hardenCookie({ httpOnly: false, sameSite: "none", maxAge: 100 });
  assert.equal(hardened.httpOnly, true);
  assert.equal(hardened.sameSite, "lax");
  assert.equal(hardened.maxAge, 60 * 60 * 24 * 30); // thirty days, whatever the library chose (its default is 400)
});

// ---- service worker ------------------------------------------------------------------------------------------------

test("the service worker never keeps the admin, auth, sign-in or account pages", () => {
  for (const p of ["/admin", "/admin/games/2026-09-04-a-at-b", "/auth/callback", "/sign-in", "/account", "/account/profile", "/accounts", "/forums", "/forums/general", "/forums/thread/x"]) {
    assert.equal(isNeverCached(p), true, p);
  }
  for (const p of ["/", "/scores", "/rankings/how", "/programs/jayton", "/results/2026/9", "/search", "/~offline", "/logos/jayton.png"]) {
    assert.equal(isNeverCached(p), false, p);
  }
  assert.deepEqual(NEVER_CACHED, ["/admin", "/auth", "/sign-in", "/account", "/forums"]);
});

test("sw.ts sends those pages to the network first of all its rules, from the same list the proxy matches", async () => {
  const { readFileSync } = await import("node:fs");
  const sw = readFileSync(new URL("../sw.ts", import.meta.url), "utf8");
  const rules = sw.slice(sw.indexOf("const runtimeCaching"));
  const firstRule = rules.split("\n").find((l) => l.includes("matcher:"));
  assert.match(firstRule, /isNeverCached\(url\.pathname\).*NetworkOnly/);
  assert.ok(rules.indexOf("isNeverCached") < rules.indexOf("NetworkFirst") && rules.indexOf("isNeverCached") < rules.indexOf("CacheFirst"));
  // proxy.ts matches the same paths (it adds no-store and refreshes the session there).
  const proxy = readFileSync(new URL("../proxy.ts", import.meta.url), "utf8");
  for (const p of NEVER_CACHED) assert.ok(proxy.includes(`"${p}"`) || proxy.includes(`"${p}/:path*"`), `proxy.ts matcher lacks ${p}`);
});

// ---- fan accounts --------------------------------------------------------------------------------------------------

test("email sign-up makes new accounts only when FAN_EMAIL_SIGNIN is exactly \"on\"", () => {
  assert.equal(fanEmailSignIn({ FAN_EMAIL_SIGNIN: "on" }), true);
  assert.equal(fanEmailSignIn({ FAN_EMAIL_SIGNIN: " on " }), true);
  for (const off of [undefined, "", "off", "ON", "true", "1", "yes", "on!"]) assert.equal(fanEmailSignIn({ FAN_EMAIL_SIGNIN: off }), false, String(off));
  assert.equal(fanEmailSignIn({}), false);
});

test("fan accounts exist only when FAN_SIGNIN is exactly \"on\"; email sign-up needs both flags", () => {
  assert.equal(fanSignIn({ FAN_SIGNIN: "on" }), true);
  for (const off of [undefined, "", "off", "ON", "true", "1", "yes", " on ", "on "]) assert.equal(fanSignIn({ FAN_SIGNIN: off }), false, String(off));
  assert.equal(fanSignIn({}), false);
  // The two flags are independent: FAN_EMAIL_SIGNIN alone does nothing.
  const cases = [
    [{}, false], [{ FAN_SIGNIN: "on" }, false], [{ FAN_EMAIL_SIGNIN: "on" }, false], [{ FAN_SIGNIN: "on", FAN_EMAIL_SIGNIN: "on" }, true],
    [{ FAN_SIGNIN: "off", FAN_EMAIL_SIGNIN: "on" }, false], [{ FAN_SIGNIN: "on", FAN_EMAIL_SIGNIN: "yes" }, false],
  ];
  for (const [env, expected] of cases) assert.equal(emailMayCreateUsers(env), expected, JSON.stringify(env));
});

test("the email action's shouldCreateUser follows both flags; Google follows only FAN_SIGNIN", async () => {
  const { readFileSync } = await import("node:fs");
  const actions = readFileSync(new URL("../app/sign-in/actions.ts", import.meta.url), "utf8");
  assert.match(actions, /shouldCreateUser: emailMayCreateUsers\(\)/);
  assert.doesNotMatch(actions, /shouldCreateUser: (true|false)/);
  const google = actions.slice(actions.indexOf("export async function signInWithGoogle"), actions.indexOf("export async function signOut"));
  assert.ok(google.includes("signInWithOAuth") && google.includes("fanSignIn()") && !google.includes("fanEmailSignIn"));
});

test("the age gate: 14 or older goes on, exactly 13 years back is asked, younger is refused, nonsense is a bad year", () => {
  const now = new Date("2026-11-12T18:00:00Z");
  assert.equal(currentYear(now), 2026);
  assert.equal(currentYear(new Date("2027-01-01T03:00:00Z")), 2026); // still Dec 31 in Texas
  assert.equal(currentYear(new Date("2027-01-01T07:00:00Z")), 2027);
  assert.equal(decideSignUp(2014, "", now), "under-13"); // 12 this year
  assert.equal(decideSignUp(2026, "", now), "under-13");
  assert.equal(decideSignUp(2012, "", now), "create"); // 14
  assert.equal(decideSignUp(2013, "", now), "ask-13");
  assert.equal(decideSignUp(2013, "yes", now), "create");
  assert.equal(decideSignUp(2013, "no", now), "under-13");
  assert.equal(decideSignUp(2014, "yes", now), "under-13"); // the answer only matters in the 13th year
  assert.equal(decideSignUp(2012, "no", now), "create");
  assert.equal(decideSignUp(2010, "", now), "create");
  assert.equal(decideSignUp(1980, "", now), "create");
  assert.equal(decideSignUp(2027, "", now), "bad-year");
  assert.equal(decideSignUp(1850, "", now), "bad-year");
  assert.equal(decideSignUp(1900, "", now), "bad-year"); // over 120
});

test("display names: slurs and look-alikes are refused, ordinary Texas names are not", () => {
  for (const bad of ["xXnazi_fanXx", "N1gg3r", "n.i.g.g.e.r", "The Fag", "Admin", "80x40", "Moderator Sam"]) assert.notEqual(displayNameProblem(bad), null, bad);
  for (const ok of ["Bobcat Fan", "Grapevine Gator", "Spicewood Dad", "Raccoon Run", "Chinkapin Oak", "Coach Cooney", "Hawley Bulldog 22", "Trapper_Keeper", "Sundown-Roughnecks"]) assert.equal(displayNameProblem(ok), null, ok);
});

test("the pages' own scripts' routes are matched by the proxy (a session is refreshed, nothing is cached)", async () => {
  const { readFileSync } = await import("node:fs");
  const proxy = readFileSync(new URL("../proxy.ts", import.meta.url), "utf8");
  for (const p of ["/api/me", "/api/follows", "/account/:path*", "/auth/:path*", "/sign-in"]) assert.ok(proxy.includes(`"${p}"`), `proxy.ts matcher lacks ${p}`);
  const sw = readFileSync(new URL("../sw.ts", import.meta.url), "utf8");
  assert.match(sw, /\/\^\\\/\(api\|_vercel\)\\\//); // /api/ goes to the network only
});
