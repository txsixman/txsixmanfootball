// The plain-words line under a playoff page's heading (lib/intros.ts): what the page holds, in the words fans search
// for, and no winner, score, betting word or source.   node --test apps/web/scripts/
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = mkdtempSync(path.join(tmpdir(), "intros-"));
const outfile = path.join(tmp, "intros.mjs");
await build({ entryPoints: [path.join(WEB, "lib/intros.ts")], bundle: true, platform: "node", format: "esm", outfile, logLevel: "error" });
const t = await import(pathToFileURL(outfile).href);
test.after(() => rmSync(tmp, { recursive: true, force: true }));

const BANNED = /\b(spreads?|odds|lines?|bets?|betting|underdogs?|favou?rites?|locks?|won|beat|defeated|winner|victory)\b|maxpreps|hudl|calpreps|sixmanfootball|dave campbell/i;
const clean = (text) => {
  assert.doesNotMatch(text, BANNED, text);
  assert.doesNotMatch(text, /\s{2,}|\s$|^\s|,,|\.\./, `stray spacing or punctuation: ${text}`);
  return text;
};

test("this season's playoffs: the league, its brackets, projections and title chances, free", () => {
  assert.equal(
    clean(t.playoffsIntro({ league: "UIL", season: 2026, brackets: ["UIL Division I", "UIL Division II"], past: false, chances: true })),
    "Every 2026 UIL six-man playoff game, Division I and Division II, round by round. Scores update through each game night, and every game still to play has a projected margin and each team's chance to win. Each team's chance at a title is under its bracket. Free to read, no sign-in.",
  );
  const tapps = clean(t.playoffsIntro({ league: "TAPPS", season: 2026, brackets: ["TAPPS Division I", "TAPPS Division II", "TAPPS Division III"], past: false, chances: false }));
  assert.match(tapps, /^Every 2026 TAPPS six-man playoff game, Division I, Division II and Division III, round by round\./);
  assert.doesNotMatch(tapps, /title/);
  assert.match(clean(t.playoffsIntro({ league: "TCAF", season: 2026, brackets: [], past: false, chances: false })), /^Every 2026 TCAF six-man playoff game round by round\./);
});

test("a past season's playoffs: every game, no projections", () => {
  const past = clean(t.playoffsIntro({ league: "UIL", season: 2024, brackets: ["UIL Division I", "UIL Division II"], past: true, chances: false }));
  assert.equal(past, "Every 2024 UIL six-man playoff game, Division I and Division II, round by round, with each team's next game showing who went on.");
  assert.doesNotMatch(past, /projected|chance/);
});

test("a bracket page", () => {
  assert.match(clean(t.bracketIntro({ name: "UIL Division I", season: 2026 })), /^The 2026 UIL Division I six-man playoff bracket, the round being played first\. .*projected margin/);
});

test("the home page's line says what a fan gets, from the data's own first seasons", () => {
  assert.equal(
    clean(t.homeEdge({ firstSeason: 2018, firstFinal: 1972 })),
    "Free, with no sign-in: scores through every game night, a projected margin and each team's chance to win for every game still to play, brackets that fill in as games finish, results since 2018 and every UIL State Championship since 1972.",
  );
});
