// The browser's live-score reading (lib/live-scores.ts, ADR 0021): the check of each row (the same rules as the Zod
// schema it replaced, proved below), the game key, and which row belongs to which game.   node --test apps/web/scripts/
import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "../lib/supabase-public.ts";
import { checkedAt, fetchLiveRows, LIVE_MAX_AGE_MS, liveKey, liveView, parseLiveRows } from "../lib/live-scores.ts";

/** The Zod schema lib/live-scores.ts used until its check was written out by hand (so phones need not download Zod). */
const REFERENCE = z.object({
  game_key: z.string().max(200),
  home: z.string().max(80),
  away: z.string().max(80),
  home_score: z.number().int().min(0).max(200),
  away_score: z.number().int().min(0).max(200),
  period: z.string().min(1).max(12).regex(/^[A-Za-z0-9 ]+$/).nullable(),
  read_at: z.iso.datetime({ offset: true }),
});

test("the hand-written check keeps and drops exactly the rows the Zod schema did, with the same fields", () => {
  const good = {
    game_key: "2026-11-13|cedar-gap|salt-fork", home: "salt-fork", away: "cedar-gap", home_score: 28, away_score: 14,
    period: "Q3", read_at: "2026-11-13T23:40:00.123+00:00",
  };
  const values = {
    game_key: ["", "k".repeat(200), "k".repeat(201), 5, null, undefined, ["a"]],
    home: ["", "h".repeat(80), "h".repeat(81), "é".repeat(80), 0, null, {}],
    home_score: [0, 200, 201, -1, 1.5, -0, NaN, Infinity, "28", null, 2 ** 53, true],
    away_score: [0, 199, 200.0001, -0.5, undefined],
    period: [null, "", " ", "OT", "Q4 0 12", "x".repeat(12), "x".repeat(13), "<b>", "Q3\n", "Ⅲ", 3, undefined, false],
    read_at: [
      "2026-11-13T23:40:00Z", "2026-11-13T23:40:00.1Z", "2026-11-13T23:40:00.123456789-05:00", "2026-11-13T23:40Z",
      "2026-11-13T23:40:00", "2026-11-13T24:00:00Z", "2026-11-13T23:60:00Z", "2026-11-13T23:40:60Z", "2026-11-13t23:40:00Z",
      "2026-11-13 23:40:00Z", "2026-11-13T23:40:00+0500", "2026-11-13T23:40:00+24:00", "2026-11-13T23:40:00+05:60",
      "2024-02-29T00:00:00Z", "2026-02-29T00:00:00Z", "2000-02-29T00:00:00Z", "1900-02-29T00:00:00Z", "0000-02-29T00:00:00Z",
      "2026-04-31T00:00:00Z", "2026-12-31T00:00:00Z", "2026-13-01T00:00:00Z", "2026-00-10T00:00:00Z", "2026-11-00T00:00:00Z",
      "２026-11-13T23:40:00Z", "2026-11-13T23:40:00.Z", "+2026-11-13T23:40:00Z", "2026-11-13", "soon", "", 0, null,
    ],
  };
  const rows = [good, null, [], [good], "row", 5, { ...good, extra: "<script>" }, Object.assign(Object.create({ home: "x" }), good)];
  for (const [key, list] of Object.entries(values)) {
    for (const v of list) {
      rows.push({ ...good, [key]: v });
      if (key === "home") rows.push({ ...good, away: v });
    }
    const { [key]: _, ...without } = good;
    rows.push(without);
  }
  let kept = 0;
  for (const row of rows) {
    const ref = REFERENCE.safeParse(row);
    const ours = parseLiveRows([row]);
    assert.deepEqual(ours, ref.success ? [ref.data] : [], `${JSON.stringify(row)}: Zod ${ref.success ? "keeps" : "drops"} it`);
    kept += ours.length;
  }
  assert.ok(kept > 20 && kept < rows.length - 40, `both sides of the rules are exercised (${kept} of ${rows.length} kept)`);
});

const NOW = Date.parse("2026-11-13T23:45:00Z");
const row = (over = {}) => ({
  game_key: "2026-11-13|cedar-gap|salt-fork", home: "salt-fork", away: "cedar-gap", home_score: 28, away_score: 14,
  period: "Q3", read_at: "2026-11-13T23:40:00.123+00:00", ...over,
});

test("a row is kept only when every field passes", () => {
  assert.equal(parseLiveRows([row(), row({ period: null }), row({ read_at: "2026-11-13T23:40:00Z" })]).length, 3);
  for (const bad of [
    { home_score: -1 }, { home_score: 201 }, { away_score: 1.5 }, { home_score: "28" }, { period: "" }, { period: "x".repeat(13) },
    { period: "<b>" }, { period: 3 }, { read_at: "soon" }, { read_at: "2026-11-13" }, { game_key: "k".repeat(201) }, { home: null },
  ]) assert.deepEqual(parseLiveRows([row(bad)]), [], JSON.stringify(bad));
  // One bad row never takes the good ones with it.
  assert.equal(parseLiveRows([row({ home_score: 500 }), row()]).length, 1);
  for (const notAList of [null, {}, "x", 5, undefined, { message: "JWT expired" }]) assert.deepEqual(parseLiveRows(notAList), []);
  assert.deepEqual(parseLiveRows(Array.from({ length: 201 }, () => row())), []);
});

test("the key is the site's: the date, then both program slugs, sorted", () => {
  assert.equal(liveKey("2026-11-13", "Salt Fork", "Cedar Gap"), "2026-11-13|cedar-gap|salt-fork");
  assert.equal(liveKey("2026-11-13", "Cedar Gap", "Salt Fork"), "2026-11-13|cedar-gap|salt-fork");
  assert.equal(liveKey("2026-11-13", "O'Brien", "Valor North Austin"), "2026-11-13|obrien|valor-north-austin");
});

test("each score lands on the right team, whichever side the row calls home", () => {
  const rows = parseLiveRows([row()]);
  // The page lists Cedar Gap as away: it scored 14 in the row's away column.
  const v = liveView(rows, { date: "2026-11-13", home: "Salt Fork", away: "Cedar Gap" }, NOW);
  assert.deepEqual([v.away.name, v.away.score, v.home.name, v.home.score, v.period], ["Cedar Gap", 14, "Salt Fork", 28, "Q3"]);
  // The same game with the page's home and away the other way round: the scores follow the teams.
  const flipped = liveView(rows, { date: "2026-11-13", home: "Cedar Gap", away: "Salt Fork" }, NOW);
  assert.deepEqual([flipped.away.score, flipped.home.score], [28, 14]);
});

test("no row, another date, a stale or future read, or a key that does not fit the teams shows nothing", () => {
  const game = { date: "2026-11-13", home: "Salt Fork", away: "Cedar Gap" };
  assert.equal(liveView([], game, NOW), null);
  assert.equal(liveView(parseLiveRows([row()]), { ...game, date: "2026-11-14" }, NOW), null);
  assert.equal(liveView(parseLiveRows([row()]), { ...game, date: undefined }, NOW), null);
  assert.equal(liveView(parseLiveRows([row({ read_at: new Date(NOW - LIVE_MAX_AGE_MS - 1000).toISOString() })]), game, NOW), null);
  assert.ok(liveView(parseLiveRows([row({ read_at: new Date(NOW - LIVE_MAX_AGE_MS + 1000).toISOString() })]), game, NOW));
  assert.equal(liveView(parseLiveRows([row({ read_at: new Date(NOW + 3600_000).toISOString() })]), game, NOW), null);
  // 0-0 with no period may be a game that has not kicked off: nothing. With a period it is shown.
  assert.equal(liveView(parseLiveRows([row({ home_score: 0, away_score: 0, period: null })]), game, NOW), null);
  assert.ok(liveView(parseLiveRows([row({ home_score: 0, away_score: 0, period: "Q1" })]), game, NOW));
  assert.ok(liveView(parseLiveRows([row({ home_score: 7, away_score: 0, period: null })]), game, NOW));
  // A key that matches but whose home and away columns name other teams cannot be placed: nothing, not a guess.
  assert.equal(liveView(parseLiveRows([row({ home: "dry-wash", away: "mesa-verde" })]), game, NOW), null);
});

test("the time is shown in Central", () => {
  assert.equal(checkedAt(new Date("2026-11-13T23:40:00Z")), "5:40 PM CT");
  assert.equal(checkedAt(new Date("2026-11-14T01:05:00Z")), "7:05 PM CT");
});

test("the request calls the live_scores function with the public key, the one push uses; a refusal throws", async () => {
  const seen = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    seen.push([String(url), init]);
    return seen.length === 1 ? new Response(JSON.stringify([row()]), { status: 200 }) : new Response("{}", { status: 404 });
  };
  try {
    assert.equal((await fetchLiveRows()).length, 1);
    assert.equal(seen[0][0], `${SUPABASE_URL}/rest/v1/rpc/live_scores`);
    assert.equal(seen[0][1].method, "POST");
    assert.equal(seen[0][1].headers.apikey, SUPABASE_PUBLISHABLE_KEY);
    assert.equal(seen[0][1].body, "{}");
    await assert.rejects(fetchLiveRows(), /404/);
  } finally {
    globalThis.fetch = real;
  }
});
