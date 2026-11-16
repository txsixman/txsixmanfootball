// /playoffs/this-round against the bracket pages (lib/this-round.ts): it lists every game its bracket's current round shows,
// the listed ones and the ones the bracket sets (ADR 0047), and counts them as the bracket page does.   node --test apps/web/scripts/
// Invented teams only. The first case is the bug of Nov 16, 2026: UIL Division I's area round had 2 listed games and 6 set by
// the bracket, /playoffs said 8, and this page said 2 (and "0 games" for a round the bracket alone had set).
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = mkdtempSync(path.join(tmpdir(), "this-round-"));
const outfile = path.join(tmp, "this-round.mjs");
await build({ entryPoints: [path.join(WEB, "lib/this-round.ts")], bundle: true, platform: "node", format: "esm", outfile, logLevel: "error" });
const { roundCount, roundTotal, thisRound } = await import(pathToFileURL(outfile).href);
test.after(() => rmSync(tmp, { recursive: true, force: true }));

const TODAY = "2026-11-16";
const listed = (date, homeScore) => ({ date, homeScore });
const built = (n) => Array.from({ length: n }, (_, i) => ({ sides: [{ team: `T${i}` }, { team: `U${i}` }] }));
const round = (name, games, set = 0) => ({ round: name, label: name, games, built: built(set) });
const bracket = (league, name, ...rounds) => ({ league, name, rounds });

const uil1 = bracket("UIL", "UIL Division I", round("bi-district", Array.from({ length: 16 }, () => listed("2026-11-13", 40))), round("area", [listed("2026-11-20"), listed("2026-11-20")], 6));
const uil2 = bracket("UIL", "UIL Division II", round("bi-district", Array.from({ length: 16 }, () => listed("2026-11-13", 40))), round("area", [listed("2026-11-20")], 7));
const tapps = bracket("TAPPS", "TAPPS Division III Large School", round("semifinal", [listed("2026-11-13", 30), listed("2026-11-13", 21)]), round("final", [], 1));
const taiao = bracket("TAIAO", "TAIAO Division 1", round("quarterfinal", [listed("2026-11-13", 30)]), round("semifinal", [], 2));
const tcaf = bracket("TCAF", "TCAF", round("final", [listed("2026-11-21")]));
const all = [tcaf, taiao, tapps, uil2, uil1];
const LEAGUES = ["UIL", "TAPPS", "TAIAO", "TCAF"];

test("this round counts every game of each bracket's current round, the listed and the set by the bracket", () => {
  const found = thisRound(all, LEAGUES, TODAY);
  const counts = Object.fromEntries(found.flatMap((g) => g.brackets.map((b) => [b.bracket.name, roundTotal(b.round)])));
  assert.deepEqual(counts, { "UIL Division I": 8, "UIL Division II": 8, "TAPPS Division III Large School": 1, "TAIAO Division 1": 2, TCAF: 1 });
});

test("no bracket's current round is '0 games' when the bracket sets games in it", () => {
  const found = thisRound(all, LEAGUES, TODAY);
  const heading = (name) => roundCount(found.flatMap((g) => g.brackets).find((b) => b.bracket.name === name).round);
  assert.equal(heading("UIL Division I"), "2 games · 6 more set by the bracket");
  assert.equal(heading("TAPPS Division III Large School"), "1 game set by the bracket");
  assert.equal(heading("TAIAO Division 1"), "2 games set by the bracket");
  assert.equal(heading("TCAF"), "1 game");
  for (const b of found.flatMap((g) => g.brackets)) assert.notEqual(roundTotal(b.round), 0);
});

test("leagues come in the order given, a league with no bracket is left out, and an empty season is empty", () => {
  assert.deepEqual(thisRound(all, LEAGUES, TODAY).map((g) => g.league), ["UIL", "TAPPS", "TAIAO", "TCAF"]);
  assert.deepEqual(thisRound([uil1], LEAGUES, TODAY).map((g) => g.league), ["UIL"]);
  assert.deepEqual(thisRound([], LEAGUES, TODAY), []);
});
