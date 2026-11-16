// /api/push/status (the push alerts switch, web half): the page asks it whether the "Game alerts on this device" switch may be
// shown. It answers { alerts: true } only when the server-only env FAN_PUSH_ALERTS is exactly "on" (a trimmed " on " counts,
// "ON", "true" and "1" do not), read at request time, never cached. It asks no database, so this runs the route as it is
// without PGlite (route-harness.mjs needs it); only the "@/" alias and the ".ts" extension are resolved, as the site's bundler does.
//   node --test apps/web/scripts/push-status.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { afterEach, test } from "node:test";

const web = new URL("../", import.meta.url);
registerHooks({
  resolve(specifier, context, next) {
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

const status = await import(new URL("../app/api/push/status/route.ts", import.meta.url).href);
const { pushAlertsOn } = await import(new URL("../lib/push-flag.ts", import.meta.url).href);

const saved = process.env.FAN_PUSH_ALERTS;
afterEach(() => {
  if (saved === undefined) delete process.env.FAN_PUSH_ALERTS;
  else process.env.FAN_PUSH_ALERTS = saved;
});

const get = async (value) => {
  if (value === undefined) delete process.env.FAN_PUSH_ALERTS;
  else process.env.FAN_PUSH_ALERTS = value;
  const res = await status.GET(new Request("http://localhost:3000/api/push/status"));
  return { status: res.status, body: await res.json(), cache: res.headers.get("cache-control") ?? "" };
};

test("unset, empty or any value but exactly \"on\": alerts is false", async () => {
  for (const value of [undefined, "", "off", "ON", "On", "true", "1", "yes", "on!", "onn", "o n"]) {
    const r = await get(value);
    assert.deepEqual([r.status, r.body], [200, { alerts: false }], JSON.stringify(value));
  }
});

test("\"on\" turns it on, and so does \" on \" (trimmed)", async () => {
  for (const value of ["on", " on ", "on\n", "\ton"]) {
    const r = await get(value);
    assert.deepEqual([r.status, r.body], [200, { alerts: true }], JSON.stringify(value));
  }
});

test("every answer, on or off, is never cached", async () => {
  for (const value of [undefined, "on", "ON"]) assert.match((await get(value)).cache, /no-store/, String(value));
});

test("it is read at request time: the same loaded route follows the env as it changes", async () => {
  assert.equal((await get("on")).body.alerts, true);
  assert.equal((await get("off")).body.alerts, false);
  assert.equal((await get("on")).body.alerts, true);
  assert.equal((await get(undefined)).body.alerts, false);
});

test("pushAlertsOn reads the env object it is given, not the process's", () => {
  assert.equal(pushAlertsOn({ FAN_PUSH_ALERTS: "on" }), true);
  assert.equal(pushAlertsOn({ FAN_PUSH_ALERTS: " on " }), true);
  for (const bad of [{}, { FAN_PUSH_ALERTS: undefined }, { FAN_PUSH_ALERTS: "" }, { FAN_PUSH_ALERTS: "ON" }, { FAN_PUSH_ALERTS: "true" }, { FAN_PUSH_ALERTS: "1" }]) {
    assert.equal(pushAlertsOn(bad), false, JSON.stringify(bad));
  }
});

test("the answer holds nothing but the one boolean, and the switch is server-only (never NEXT_PUBLIC)", async () => {
  assert.deepEqual(Object.keys((await get("on")).body), ["alerts"]);
  const flag = readFileSync(new URL("../lib/push-flag.ts", import.meta.url), "utf8");
  assert.doesNotMatch(flag, /NEXT_PUBLIC_/);
  assert.doesNotMatch(readFileSync(new URL("../app/api/push/status/route.ts", import.meta.url), "utf8"), /NEXT_PUBLIC_FAN_PUSH_ALERTS|console\./);
});
