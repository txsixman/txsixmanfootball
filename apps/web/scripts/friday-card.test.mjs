// What the game-night share cards say (lib/friday-card.ts): projection for a game to play, score under "Final" for a
// finished one, the word for a forfeit, no winner, no betting word, no source, "+N more".   node --test apps/web/scripts/
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = mkdtempSync(path.join(tmpdir(), "friday-card-"));
const outfile = path.join(tmp, "friday-card.mjs");
await build({ entryPoints: [path.join(WEB, "lib/friday-card.ts")], bundle: true, platform: "node", format: "esm", outfile, logLevel: "error" });
const c = await import(pathToFileURL(outfile).href);
test.after(() => rmSync(tmp, { recursive: true, force: true }));

const BANNED = /\b(spreads?|odds|lines?|bets?|betting|underdogs?|favou?rites?|locks?|won|beat|defeated|winner|victory)\b|maxpreps|hudl|calpreps|sixmanfootball|dave campbell|80x40/i;
const game = (over = {}) => ({ tag: "UIL D1", away: "Jayton", home: "Guthrie", state: "later", confirmed: true, projected: "Jayton by 12 · 74% chance to win", ...over });
const words = (cells) => cells.flatMap((x) => [x.tag, x.away, x.home, x.status]).join(" | ");

test("a game still to play shows its projection, away team first", () => {
  const { cells, more } = c.cardCells([game()]);
  assert.deepEqual(cells, [{ tag: "UIL D1", away: "Jayton", home: "Guthrie", status: "Jayton by 12 · 74% chance to win" }]);
  assert.equal(more, 0);
  assert.equal(c.cardCells([game({ projected: undefined })]).cells[0].status, "Not yet played");
});

test("a finished game shows its score under Final, or Score reported when unconfirmed; no winner is named", () => {
  const done = c.cardCells([game({ state: "final", awayScore: 14, homeScore: 42 }), game({ state: "final", awayScore: 7, homeScore: 7, confirmed: false })]).cells;
  assert.deepEqual([done[0].status, done[0].awayScore, done[0].homeScore], ["Final", 14, 42]);
  assert.equal(done[1].status, "Score reported");
  for (const cell of done) assert.doesNotMatch(words([cell]), BANNED);
});

test("a forfeit is the word, never a score", () => {
  const { cells } = c.cardCells([game({ state: "forfeit", awayScore: 1, homeScore: 0 })]);
  assert.equal(cells[0].status, "Forfeit");
  assert.equal(cells[0].awayScore, undefined);
  assert.equal(cells[0].homeScore, undefined);
});

test("more than six games draw six and say +N more", () => {
  const many = Array.from({ length: 9 }, (_, i) => game({ away: `Team ${i}` }));
  const { cells, more } = c.cardCells(many);
  assert.equal(cells.length, 6);
  assert.equal(more, 3);
  assert.equal(c.moreText(more), "+3 more");
  assert.equal(c.moreText(0), "");
  assert.equal(c.gamesText(1), "1 game");
  assert.equal(c.gamesText(6), "6 games");
});

test("the last playoff round is the State Championship, never final", () => {
  for (const label of ["State final", "Final", "final"]) assert.equal(c.roundName(label), "State Championship");
  for (const label of ["Semifinal", "Quarterfinal", "Regional", "Bi-district"]) assert.equal(c.roundName(label), label);
});
