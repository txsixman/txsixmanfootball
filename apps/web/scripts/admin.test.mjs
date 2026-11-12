// The admin console's plain-code parts: what it may write and where, the audit order and the inputs it accepts (lib/admin).   node --test apps/web/scripts/
import assert from "node:assert/strict";
import { test } from "node:test";
import { AuditFailed, entityId, writeAudit } from "../lib/admin/audit.ts";
import { runEdit } from "../lib/admin/edit.ts";
import { appendGameCorrection, appendProgramMerge, alignmentSchools, GAME_HEADER, gameId, idSeason, parseSeasonGames, PROGRAM_HEADER, readCorrections, searchGames, unlistedNames } from "../lib/admin/files.ts";
import { Conflict, CORRECTION_FILES, GithubError, repoClient } from "../lib/admin/github.ts";
import { fieldErrors, formFields, freeText, GameFixInput, MergeInput, oneLine, SearchInput, urlCell } from "../lib/admin/inputs.ts";

const TOKEN = "github_pat_SECRET_TOKEN_VALUE";
const stamp = { source_url: "https://example.com/box", reason: "box score", corrected_on: "2030-11-01" };

// ---- files ---------------------------------------------------------------------------------------------------------

test("a correction is appended to a header-only file, keeping every earlier row", () => {
  const row = { game_date: "2026-09-04", home: "Jayton", away: "Guthrie", action: "score", home_score: "52", away_score: "6", ...stamp };
  const one = appendGameCorrection(`${GAME_HEADER}\n`, row);
  const two = appendGameCorrection(one, { ...row, home_score: "53" });
  assert.equal(two.trim().split("\n").length, 3);
  assert.ok(two.startsWith(one));
  assert.equal(readCorrections(two, null).games.size, 1); // the last row for the game wins
});

test("an append refuses a wrong header, a comma, an invalid row and a merge chain", () => {
  const row = { game_date: "2026-09-04", home: "Jayton", away: "Guthrie", action: "score", home_score: "52", away_score: "6", ...stamp };
  assert.throws(() => appendGameCorrection("home,away\n", row), /header/);
  assert.throws(() => appendGameCorrection(`${GAME_HEADER}\n`, { ...row, reason: "a, b" }), /comma/);
  assert.throws(() => appendGameCorrection(`${GAME_HEADER}\n`, { ...row, home_score: "999" }), /0 to 200/);
  assert.throws(() => appendGameCorrection(`${GAME_HEADER}\n`, { ...row, source_url: "http://example.com" }));
  const merge = { name: "B", same_as: "C", ...stamp };
  const file = appendProgramMerge(`${PROGRAM_HEADER}\n`, { name: "A", same_as: "B", ...stamp });
  assert.throws(() => appendProgramMerge(file, merge), /itself merged/);
});

const GAMES = [
  "division,round,game_date,home,away,neutral,home_score,away_score,end_reason,end_period,source_url,notes",
  "I,season,2026-09-04,Jayton,Guthrie,false,52,6,unknown,,https://x.test/a,",
  "I,season,2026-09-11,Faith Acad,Guthrie,false,10,7,unknown,,https://x.test/b,",
  "I,season,2026-10-02,Strawn,Jayton,false,20,21,unknown,,https://x.test/c,",
  "I,season,2025-10-02,Strawn,Jayton,false,20,21,unknown,,https://x.test/d,",
].join("\n");

test("the console's game ids are the site's, from merged names, and a season only holds its own games", () => {
  const games = parseSeasonGames(2026, GAMES, new Map([["Faith Acad", "Faith Academy"]]));
  assert.deepEqual(games.map((g) => g.id), [
    "2026-09-04-guthrie-at-jayton",
    "2026-09-11-guthrie-at-faith-academy",
    "2026-10-02-jayton-at-strawn",
  ]);
  assert.equal(gameId("2026-09-04", "Jayton", "Guthrie"), games[0].id);
  assert.deepEqual(parseSeasonGames(2026, null, new Map()), []);
});

test("search finds a team in any spelling, or a date, newest first, and says when there is more", () => {
  const games = parseSeasonGames(2026, GAMES, new Map());
  assert.deepEqual(searchGames(games, { q: "JAYTON" }).found.map((g) => g.date), ["2026-10-02", "2026-09-04"]);
  assert.deepEqual(searchGames(games, { date: "2026-09-11" }).found.map((g) => g.home), ["Faith Acad"]);
  assert.deepEqual(searchGames(games, { q: "faith-acad" }).found.length, 1);
  assert.equal(searchGames(games, { q: "a" }, 2).more, true);
  assert.deepEqual(unlistedNames(games, new Set(["jayton", "guthrie", "strawn"])), ["Faith Acad"]);
});

test("only a real game id names a season", () => {
  assert.equal(idSeason("2026-09-04-guthrie-at-jayton"), 2026);
  for (const bad of ["", "../../etc", "2026-09-04", "1999-09-04-a-at-b", "2026-09-04-a-at-b/../x", "2026-09-04-A-at-b"]) assert.equal(idSeason(bad), null, bad);
});

test("alignment school names come from the file's fifth column", () => {
  assert.deepEqual(alignmentSchools("league,division,region,district,school,source_url\nUIL,I,1,1,Jayton,https://x\n"), ["Jayton"]);
});

// ---- inputs --------------------------------------------------------------------------------------------------------

test("form text becomes one CSV-safe line", () => {
  assert.equal(oneLine("  box score,\n  final  "), "box score; final");
  assert.equal(urlCell("https://a.test/x?a=1,2"), "https://a.test/x?a=1%2C2");
  assert.equal(oneLine('the "final" score'), "the 'final' score");
  assert.equal(urlCell('https://a.test/x?q="1"'), "https://a.test/x?q=%221%22");
  // A leading = + - or @ is stripped from free text (a spreadsheet would run it as a formula), inside the text is kept.
  assert.equal(freeText(' =HYPERLINK("x") final'), "HYPERLINK('x') final");
  assert.equal(freeText("-+@ = box score 2-1"), "box score 2-1");
  assert.equal(freeText("final = 2-1"), "final = 2-1");
});

const fix = (over) => ({ action: "score", id: "2026-09-04-guthrie-at-jayton", home_score: "52", away_score: "6", source_url: "https://example.com/box", reason: "box score", ...over });

test("a game fix is validated: scores 0 to 200, a real https url, a real id, a winner for a forfeit", () => {
  assert.equal(GameFixInput.safeParse(fix()).success, true);
  assert.equal(GameFixInput.safeParse(fix({ home_score: "0", away_score: "200" })).success, true);
  for (const bad of [
    { home_score: "201" }, { home_score: "-1" }, { home_score: "" }, { home_score: "5.5" }, { away_score: "x" },
    { source_url: "http://example.com" }, { source_url: "javascript:alert(1)" }, { source_url: "https://" }, { source_url: "ftp://a.test/x" },
    { id: "../x" }, { id: "2026-09-04" }, { reason: "" }, { reason: "x" }, { action: "winner" },
  ]) assert.equal(GameFixInput.safeParse(fix(bad)).success, false, JSON.stringify(bad));
  assert.equal(GameFixInput.safeParse(fix({ action: "forfeit", winner: "home" })).success, true);
  assert.equal(GameFixInput.safeParse(fix({ action: "forfeit" })).success, false);
  assert.equal(GameFixInput.safeParse(fix({ action: "void" })).success, true);
  const r = GameFixInput.safeParse(fix({ reason: "box score, final\nreviewed", source_url: "https://example.com/a,b" }));
  assert.equal(r.data.reason, "box score; final reviewed");
  assert.equal(r.data.source_url, "https://example.com/a%2Cb");
  const f = GameFixInput.safeParse(fix({ reason: '=cmd|"/c calc"!A1' }));
  assert.equal(f.data.reason, "cmd|'/c calc'!A1", "a formula-looking reason is defused and a quote becomes an apostrophe");
  assert.equal(GameFixInput.safeParse(fix({ reason: "=+-@" })).success, false, "nothing left after the strip: refused");
  assert.equal(fieldErrors(GameFixInput.safeParse(fix({ home_score: "999" })).error).home_score, "0 to 200");
});

test("a merge needs two different names; a search needs a team or a date", () => {
  const m = { name: "Faith Acad", same_as: "Faith Academy", source_url: "https://example.com/x", reason: "same school" };
  assert.equal(MergeInput.safeParse(m).success, true);
  assert.equal(MergeInput.safeParse({ ...m, same_as: "Faith Acad" }).success, false);
  assert.equal(SearchInput.safeParse({}).success, false);
  assert.equal(SearchInput.safeParse({ q: "jayton" }).success, true);
  assert.equal(SearchInput.safeParse({ date: "2026-09-04" }).success, true);
  assert.equal(SearchInput.safeParse({ date: "soon" }).success, false);
});

test("only the named form fields reach a schema, and only as strings", () => {
  const data = new FormData();
  data.set("id", "x");
  data.set("evil", "y");
  data.set("file", new Blob(["z"]), "z.txt");
  assert.deepEqual(formFields(data, ["id", "file", "missing"]), { id: "x", file: "", missing: "" });
});

// ---- GitHub: where a write may go ----------------------------------------------------------------------------------

/** A fake GitHub: serves `files`, records every call, and answers PUTs from `puts` (default: ok). */
function fakeGithub({ files = {}, puts = [] } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const path = String(url).replace(/^https:\/\/api\.github\.com\/repos\/[^/]+\/[^/]+\/contents\//, "").replace(/\?.*$/, "");
    if ((init.method ?? "GET") === "PUT") {
      const status = puts.shift() ?? 200;
      return new Response(JSON.stringify({ commit: { sha: "c0ffee" } }), { status });
    }
    const file = files[path];
    if (file === undefined) return new Response("", { status: 404 });
    if (String(init.headers?.Accept).includes("raw")) return new Response(file.text);
    return new Response(JSON.stringify({ sha: file.sha, encoding: "base64", content: Buffer.from(file.text).toString("base64") }));
  };
  return { calls, client: repoClient(TOKEN, fetchImpl) };
}
const puts = (calls) => calls.filter((c) => c.init.method === "PUT");

test("writes go only to the two correction files, whatever name a caller gives", async () => {
  assert.deepEqual(Object.values(CORRECTION_FILES), ["data/corrections/games.csv", "data/corrections/programs.csv"]);
  const { client, calls } = fakeGithub();
  for (const kind of ["../../.github/workflows/ci.yml", "data/seed/maxpreps-2026/games.csv", "__proto__", "toString", ""]) {
    await assert.rejects(client.editCorrectionFile(kind, "h", (t) => t, "m"), /not a correction file/, kind);
    await assert.rejects(client.readCorrectionFile(kind), /not a correction file/, kind);
  }
  assert.equal(calls.length, 0);
  await client.editCorrectionFile("games", GAME_HEADER, (t) => `${t}row\n`, "m");
  assert.equal(puts(calls).length, 1);
  assert.match(puts(calls)[0].url, /\/contents\/data\/corrections\/games\.csv$/);
});

test("a write commits to main with the file's sha, a base64 body and the bearer token", async () => {
  const { client, calls } = fakeGithub({ files: { "data/corrections/games.csv": { text: `${GAME_HEADER}\nold\n`, sha: "abc123" } } });
  const result = await client.editCorrectionFile("games", GAME_HEADER, (t) => `${t}new\n`, "Admin: score 2026-09-04");
  assert.equal(result.commit, "c0ffee");
  const [put] = puts(calls);
  const body = JSON.parse(put.init.body);
  assert.equal(body.branch, "main");
  assert.equal(body.sha, "abc123");
  assert.equal(body.message, "Admin: score 2026-09-04");
  assert.equal(Buffer.from(body.content, "base64").toString(), `${GAME_HEADER}\nold\nnew\n`);
  assert.equal(put.init.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(put.init.cache, "no-store");
});

test("a file that does not exist yet is created from its header, with no sha", async () => {
  const { client, calls } = fakeGithub();
  await client.editCorrectionFile("games", GAME_HEADER, (t) => `${t}row\n`, "m");
  const body = JSON.parse(puts(calls)[0].init.body);
  assert.equal("sha" in body, false);
  assert.equal(Buffer.from(body.content, "base64").toString(), `${GAME_HEADER}\nrow\n`);
});

test("a stale sha (the robot committed meanwhile) reads again and re-applies the edit; endless conflicts give up", async () => {
  const files = { "data/corrections/games.csv": { text: "v0\n", sha: "s0" } };
  const { client, calls } = fakeGithub({ files, puts: [409, 422, 200] });
  const seen = [];
  await client.editCorrectionFile("games", "h", (t) => (seen.push(t), `${t}x\n`), "m");
  assert.equal(seen.length, 3);
  assert.equal(puts(calls).length, 3);
  const stuck = fakeGithub({ files, puts: [409, 409, 409, 409] });
  await assert.rejects(stuck.client.editCorrectionFile("games", "h", (t) => t, "m"), Conflict);
  assert.equal(puts(stuck.calls).length, 3);
});

test("reads are limited to the data files the console searches", async () => {
  const { client } = fakeGithub({ files: { "data/seed/maxpreps-2026/games.csv": { text: "rows" }, "docs/secret.md": { text: "no" } } });
  assert.equal(await client.readText("data/seed/maxpreps-2026/games.csv"), "rows");
  assert.equal(await client.readText("data/seed/uil-2026-28/alignments.csv"), null);
  for (const path of ["docs/secret.md", ".env", "data/seed/maxpreps-2026/../../../.env", "data/seed/schools/identity.json", "data/ratings/2026.json", "apps/web/lib/games.ts"]) {
    await assert.rejects(client.readText(path), /not a readable path/, path);
  }
});

test("a GitHub failure names the status and never the token or the response", async () => {
  const fetchImpl = async () => new Response(`echo ${TOKEN}`, { status: 403 });
  const client = repoClient(TOKEN, fetchImpl);
  const error = await client.readCorrectionFile("games").catch((e) => e);
  assert.ok(error instanceof GithubError);
  assert.equal(error.status, 403);
  assert.doesNotMatch(error.message, /SECRET|github_pat/);
});

// ---- the order of an edit ------------------------------------------------------------------------------------------

const entry = { entity: "game_correction", key: "k", before: {}, after: {}, reason: "why" };
const run = (deps) => runEdit(deps, { kind: "games", entry, edit: (t) => t, message: "m" });

test("the audit row is written first, then the commit", async () => {
  const log = [];
  const result = await run({ audit: async () => log.push("audit"), commit: async () => (log.push("commit"), { commit: "abc" }) });
  assert.deepEqual(log, ["audit", "commit"]);
  assert.deepEqual(result, { ok: true, commit: "abc" });
});

test("if the audit row cannot be written, nothing is committed", async () => {
  let committed = false;
  await assert.rejects(
    run({ audit: async () => { throw new AuditFailed(); }, commit: async () => { committed = true; return { commit: "" }; } }),
    AuditFailed,
  );
  assert.equal(committed, false);
});

test("a failed commit is followed by an audit row that says it was NOT applied", async () => {
  for (const [error, reason] of [[new Conflict(), "conflict"], [new GithubError("x", 500), "github"], [new Error("file would not parse"), "invalid"]]) {
    const audits = [];
    const result = await run({ audit: async (e) => audits.push(e), commit: async () => { throw error; } });
    assert.deepEqual(result, { ok: false, reason });
    assert.equal(audits.length, 2);
    assert.match(audits[1].reason, new RegExp(`^NOT APPLIED \\(${reason}\\)`));
    assert.equal(audits[1].after.applied, false);
  }
});

// ---- audit rows ----------------------------------------------------------------------------------------------------

test("entity ids are stable version-5 uuids, different per edited thing", () => {
  const a = entityId("game_correction", "2026-09-04-guthrie-at-jayton");
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(a, entityId("game_correction", "2026-09-04-guthrie-at-jayton"));
  assert.notEqual(a, entityId("program_merge", "2026-09-04-guthrie-at-jayton"));
  assert.notEqual(a, entityId("game_correction", "2026-09-11-guthrie-at-jayton"));
});

test("an audit row carries who, what, before, after and why; a refusal throws without detail", async () => {
  const called = [];
  const supabase = (error) => ({ rpc: async (name, args) => (called.push({ name, args }), { error }) });
  await writeAudit(supabase(null), { ...entry, before: { home_score: 1 }, after: { home_score: 2 } });
  // Through the function only, and with no actor: the database sets that from the session.
  assert.equal(called[0].name, "record_admin_audit");
  assert.deepEqual(Object.keys(called[0].args).sort(), ["p_after", "p_before", "p_entity", "p_entity_id", "p_reason"]);
  assert.deepEqual(called[0].args.p_after, { key: "k", home_score: 2 });
  const failure = await writeAudit(supabase({ message: `leaked ${TOKEN}` }), entry).catch((e) => e);
  assert.ok(failure instanceof AuditFailed);
  assert.doesNotMatch(failure.message, /leaked|SECRET/);
});

// ---- moderation overrides --------------------------------------------------------------------------------------------

test("an override needs a known op, a uuid and a reason; nothing else reaches the database", async () => {
  const { ModerateInput } = await import("../lib/admin/inputs.ts");
  const id = "6f1c2b0e-8a7d-4e53-9b61-2c0d9f4a7e18";
  assert.ok(ModerateInput.safeParse({ op: "ban", id, reason: "slurs in three posts" }).success);
  for (const bad of [{ op: "delete", id, reason: "x y z" }, { op: "ban", id: "1 or 1=1", reason: "x y z" }, { op: "ban", id, reason: "" }, { op: "ban", id, reason: "a".repeat(301) }]) {
    assert.equal(ModerateInput.safeParse(bad).success, false, JSON.stringify(bad).slice(0, 60));
  }
  assert.equal(ModerateInput.parse({ op: "unmute", id, reason: "=HYPERLINK(1)" }).reason, "HYPERLINK(1)");
});

test("each override calls its one admin function with the admin's session, and maps the database's answers", async () => {
  const { moderate } = await import("../lib/admin/moderation.ts");
  const id = "6f1c2b0e-8a7d-4e53-9b61-2c0d9f4a7e18";
  const calls = [];
  const fake = (error = null) => ({ rpc: async (fn, args) => (calls.push([fn, args]), { data: null, error }) });
  assert.equal(await moderate(fake(), { op: "unhide", id, reason: "fine" }), "done");
  assert.equal(await moderate(fake(), { op: "unmute", id, reason: "fine" }), "done");
  assert.equal(await moderate(fake(), { op: "ban", id, reason: "spam" }), "done");
  assert.equal(await moderate(fake(), { op: "unban", id, reason: "appeal" }), "done");
  assert.deepEqual(calls, [
    ["admin_unhide_post", { p_post: id, p_reason: "fine" }],
    ["admin_unmute", { p_user: id, p_reason: "fine" }],
    ["admin_set_ban", { p_user: id, p_banned: true, p_reason: "spam" }],
    ["admin_set_ban", { p_user: id, p_banned: false, p_reason: "appeal" }],
  ]);
  assert.equal(await moderate(fake({ code: "42501", message: "admin_only" }), { op: "ban", id, reason: "spam" }), "denied");
  assert.equal(await moderate(fake({ code: "P0001", message: "not_found" }), { op: "ban", id, reason: "spam" }), "already");
  assert.equal(await moderate(fake({ code: "XX000", message: "boom" }), { op: "ban", id, reason: "spam" }), "failed");
});

test("the overview is empty lists on odd data and null when refused", async () => {
  const { moderationOverview } = await import("../lib/admin/moderation.ts");
  const answer = (data, error = null) => ({ rpc: async () => ({ data, error }) });
  assert.equal(await moderationOverview(answer(null, { code: "42501", message: "admin_only" })), null);
  assert.deepEqual(await moderationOverview(answer({ hidden_posts: "x" })), { hidden_posts: [], restricted: [] });
  assert.deepEqual(await moderationOverview(answer({ hidden_posts: [], restricted: [{ user_id: "u" }] })), { hidden_posts: [], restricted: [{ user_id: "u" }] });
});

test("the game and alignment readers go by header names, so the public files without source_url or notes read the same", () => {
  const full = [
    "division,round,game_date,home,away,neutral,home_score,away_score,end_reason,end_period,source_url,notes",
    "I,season,2026-09-04,Jayton,Guthrie,false,52,6,unknown,,https://x.test/a,",
  ].join("\n");
  const trimmed = ["division,round,game_date,home,away,neutral,home_score,away_score,end_reason,end_period", "I,season,2026-09-04,Jayton,Guthrie,false,52,6,unknown,"].join("\n");
  assert.deepEqual(parseSeasonGames(2026, trimmed, new Map()), parseSeasonGames(2026, full, new Map()));
  assert.equal(parseSeasonGames(2026, trimmed, new Map()).length, 1);
  assert.deepEqual(alignmentSchools("league,division,region,district,school\nUIL,I,1,1,Jayton"), ["Jayton"]);
  assert.deepEqual(alignmentSchools("league,division,region,district,school,source_url\nUIL,I,1,1,Jayton,https://x.test"), ["Jayton"]);
});
