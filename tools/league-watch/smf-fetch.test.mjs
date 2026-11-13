import assert from "node:assert/strict";
import { test } from "node:test";
import { createFetcher, retryAfterMs, USER_AGENT } from "./smf-fetch.mjs";

// ADR 0020's fetching rules, with a fake site: every request is recorded, nothing reaches the network.
const ROBOTS = "User-agent: ClaudeBot\nDisallow: /\n\nUser-agent: *\nDisallow: /posts/\nDisallow: /admin.php\nAllow: /\n";

function site(pages, robots = { status: 200, body: ROBOTS }) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, ua: init.headers["user-agent"], redirect: init.redirect });
    const path = new URL(url).pathname;
    const r = path === "/robots.txt" ? robots : (pages[path]?.shift?.() ?? pages[path] ?? { status: 404 });
    return { status: r.status, text: async () => r.body ?? "", headers: { get: (h) => r.headers?.[h] ?? null } };
  };
  const slept = [];
  return { calls, slept, fetcher: (opts = {}) => createFetcher({ allowed: (p) => p.startsWith("/scores/"), fetchImpl, sleep: async (ms) => slept.push(ms), delayMs: 0, ...opts }) };
}

test("every request names our bot honestly and never follows a redirect", async () => {
  const s = site({ "/scores/a": { status: 200, body: "ok" } });
  const f = s.fetcher();
  await f.start();
  assert.equal(await f.get("/scores/a"), "ok");
  assert.ok(s.calls.every((c) => c.ua === USER_AGENT && c.redirect === "manual"));
  assert.match(USER_AGENT, /^TXSixManFootballBot\//);
  assert.doesNotMatch(USER_AGENT, /claude|anthropic|mozilla|chrome|safari/i);
});

test("no robots.txt, no read; and no page before robots.txt", async () => {
  await assert.rejects(site({}, { status: 503 }).fetcher().start(), /robots\.txt answered 503/);
  await assert.rejects(site({}).fetcher().get("/scores/a"), /start\(\) reads robots\.txt/);
});

test("a path robots.txt disallows, or one that is not a score page, is never requested", async () => {
  const s = site({});
  const any = s.fetcher({ allowed: () => true });
  await any.start();
  await assert.rejects(any.get("/posts/123"), /robots\.txt disallows/);
  await assert.rejects(any.get("/admin.php"), /robots\.txt disallows/);
  const scores = s.fetcher();
  await scores.start();
  await assert.rejects(scores.get("/threads/x"), /not a score page/);
  await assert.rejects(scores.get("//evil.example/scores/"), /not a path on the site/);
  assert.ok(s.calls.every((c) => new URL(c.url).pathname === "/robots.txt"));
});

test("robots.txt naming our bot is obeyed too", async () => {
  const s = site({ "/scores/a": { status: 200, body: "ok" } }, { status: 200, body: "User-agent: TXSixManFootballBot\nDisallow: /scores/\n" });
  const f = s.fetcher();
  await f.start();
  await assert.rejects(f.get("/scores/a"), /robots\.txt disallows/);
});

test("429 and 5xx back off (Retry-After first), a refusal stops the run, and repeated failures end it", async () => {
  const s = site({
    "/scores/a": [{ status: 429, headers: { "retry-after": "7" } }, { status: 503 }, { status: 200, body: "ok" }],
    "/scores/x": { status: 403 },
    "/scores/b": { status: 500 },
    "/scores/c": { status: 500 },
  });
  const f = s.fetcher({ maxFailures: 2 });
  await f.start();
  assert.equal(await f.get("/scores/a"), "ok");
  assert.deepEqual(s.slept, [7000, 30_000]);
  await assert.rejects(f.get("/scores/x"), /refused us: stopping/);
  assert.equal(await f.get("/scores/b"), null); // given up after its retries
  await assert.rejects(f.get("/scores/c"), /2 pages failed this run/);
});

test("Retry-After reads seconds or a date, capped at two minutes", () => {
  assert.equal(retryAfterMs("5"), 5000);
  assert.equal(retryAfterMs("9999"), 120_000);
  assert.equal(retryAfterMs(new Date(1_000_000 + 20_000).toUTCString(), 1_000_000), 20_000);
  assert.equal(retryAfterMs(null), undefined);
  assert.equal(retryAfterMs("soon"), undefined);
});
