import { expect, test } from "@playwright/test";
import { bracketTitleChances, parseTemplate, titleChances, type SemifinalPairs } from "../lib/title-chances";

// Region closure with invented brackets: 32 invented teams, four regions of eight, named "R<region>-<n>".
const BRACKET = "UIL Division I";
const team = (r: number, n: number) => `R${r}-${n}`;
const regionOf = (name: string) => /^R(\d)-\d$/.exec(name)?.[1];
const table = (by: Record<string, number> = {}) => ({
  games: 100, home_field: 4, sigma: 20,
  teams: Array.from({ length: 32 }, (_, i) => {
    const name = team(Math.floor(i / 8) + 1, (i % 8) + 1);
    return { team: name, rating: by[name] ?? 0, rated: 9, won: 5, lost: 4, tied: 0 };
  }),
});
const game = (round: string, home: string, away: string, played = false, neutral = true) => ({ bracket: BRACKET, round, home, away, played, neutral });
const sum = (cs: { chance: number }[]) => cs.reduce((n, c) => n + c.chance, 0);
/** A region's two unplayed area games: 1 v 2 and 3 v 4. */
const areas = (r: number) => [game("area", team(r, 1), team(r, 2)), game("area", team(r, 3), team(r, 4))];
const SEMIS: SemifinalPairs = [["1", "2"], ["3", "4"]];

test("two unplayed area games give each of their four teams a region title chance", () => {
  const even = titleChances(table(), areas(1), { regionOf }).regions;
  expect(even).toHaveLength(1);
  expect(even[0]).toMatchObject({ bracket: BRACKET, region: "1", round: "area" });
  for (const c of even[0].chances) expect(c.chance).toBeCloseTo(0.25, 6);
  const tilted = titleChances(table({ "R1-1": 30, "R1-4": -10 }), areas(1), { regionOf }).regions[0].chances;
  expect(tilted[0].team).toBe("R1-1");
  expect(tilted.map((c) => c.team).sort()).toEqual(["R1-1", "R1-2", "R1-3", "R1-4"]);
  expect(sum(tilted)).toBeCloseTo(1, 6);
});

test("a region with its regional game set splits the title between its two teams", () => {
  const { regions } = titleChances(table({ "R2-5": 20 }), [game("regional", "R2-5", "R2-6")], { regionOf });
  expect(regions).toHaveLength(1);
  expect(regions[0].round).toBe("regional");
  expect(regions[0].chances.map((c) => c.team)).toEqual(["R2-5", "R2-6"]);
  expect(sum(regions[0].chances)).toBeCloseTo(1, 6);
  // Neutral, equal teams split evenly; at the host's own site the host gets the home edge.
  const neutral = titleChances(table(), [game("regional", "R2-5", "R2-6")], { regionOf }).regions[0].chances[0].chance;
  const home = titleChances(table(), [game("regional", "R2-5", "R2-6", false, false)], { regionOf }).regions[0];
  expect(neutral).toBeCloseTo(0.5, 6);
  expect(home.chances[0].team).toBe("R2-5");
  expect(home.chances[0].chance).toBeGreaterThan(0.5);
});

test("each region stands alone: one region settled shows only that region", () => {
  const games = [...areas(1), game("area", team(3, 1), team(3, 2))]; // region 3 has one area game only
  const { regions } = titleChances(table(), games, { regionOf });
  expect(regions.map((r) => r.region)).toEqual(["1"]);
});

test("nothing is shown where the data does not settle the path", () => {
  const none = (games: ReturnType<typeof game>[]) => titleChances(table(), games, { regionOf }).regions;
  // Bi-district games alone: who meets in the area round is not in the data.
  expect(none([game("bi-district", team(1, 1), team(1, 2)), game("bi-district", team(1, 3), team(1, 4))])).toEqual([]);
  // One area game of two.
  expect(none([game("area", team(1, 1), team(1, 2))])).toEqual([]);
  // A played, unconfirmed area game settles nothing (ADR 0004).
  expect(none([game("area", team(1, 1), team(1, 2), true), game("area", team(1, 3), team(1, 4))])).toEqual([]);
  // A played regional game names no region winner.
  expect(none([game("regional", team(1, 1), team(1, 2), true)])).toEqual([]);
  // Three area games in a region: not the shape the rule rests on.
  expect(none([...areas(1), game("area", team(1, 5), team(1, 6))])).toEqual([]);
  // The same team in both area games.
  expect(none([game("area", team(1, 1), team(1, 2)), game("area", team(1, 1), team(1, 3))])).toEqual([]);
});

test("a game that links two regions, or a team of unknown region, voids the closure for the whole bracket", () => {
  const cross = [...areas(1), game("area", team(2, 1), team(3, 1))];
  expect(titleChances(table(), cross, { regionOf }).regions).toEqual([]);
  const unknown = [...areas(1), game("area", "Not In Alignments", team(2, 1))];
  expect(titleChances(table(), unknown, { regionOf }).regions).toEqual([]);
});

test("an unrated team in a region leaves it blank rather than guessed", () => {
  const t = table();
  t.teams = t.teams.filter((x) => x.team !== "R1-3");
  expect(titleChances(t, areas(1), { regionOf }).regions).toEqual([]);
});

test("state title chances need the hand-entered semifinal pairing and all four regions settled", () => {
  const all = [1, 2, 3, 4].flatMap(areas);
  const without = titleChances(table(), all, { regionOf });
  expect(without.regions).toHaveLength(4);
  expect(without.state).toBeUndefined();

  const withTemplate = titleChances(table(), all, { regionOf, semifinals: SEMIS });
  expect(withTemplate.state?.round).toBe("regional");
  expect(withTemplate.state!.chances).toHaveLength(16);
  expect(sum(withTemplate.state!.chances)).toBeCloseTo(1, 6);
  for (const c of withTemplate.state!.chances) expect(c.chance).toBeCloseTo(1 / 16, 6);
  // A team's state chance cannot exceed its region chance.
  const strong = titleChances(table({ "R3-1": 40 }), all, { regionOf, semifinals: SEMIS });
  const region3 = strong.regions.find((r) => r.region === "3")!.chances.find((c) => c.team === "R3-1")!.chance;
  expect(strong.state!.chances[0].team).toBe("R3-1");
  expect(strong.state!.chances[0].chance).toBeLessThan(region3);

  // Three regions settled: the path to the final is not determined.
  expect(titleChances(table(), [1, 2, 3].flatMap(areas), { regionOf, semifinals: SEMIS }).state).toBeUndefined();
  // The pairing matters: the same data under another pairing gives other state chances.
  const ratings = table({ "R1-1": 40, "R2-1": 40 });
  const other = titleChances(ratings, all, { regionOf, semifinals: [["1", "3"], ["2", "4"]] });
  const shared = titleChances(ratings, all, { regionOf, semifinals: SEMIS });
  const chance = (r: typeof other, name: string) => r.state!.chances.find((c) => c.team === name)!.chance;
  expect(chance(other, "R1-1")).not.toBeCloseTo(chance(shared, "R1-1"), 3);
});

test("once the semifinals are on the schedule the data takes over from the template", () => {
  const semis = [game("semifinal", team(1, 1), team(2, 1)), game("semifinal", team(3, 1), team(4, 1))];
  const { state } = titleChances(table(), [...semis, ...[1, 2, 3, 4].flatMap(areas)], { regionOf, semifinals: SEMIS });
  expect(state?.round).toBe("semifinal");
  expect(state!.chances).toHaveLength(4);
});

test("the bracket template: parsed, checked, and keyed by bracket name", () => {
  const csv = "division,semifinal,region_a,region_b\nI,1,1,2\nI,2,3,4\nII,1,1,3\nII,2,2,4\n";
  const t = parseTemplate(csv);
  expect(t.get("UIL Division I")).toEqual([["1", "2"], ["3", "4"]]);
  expect(t.get("UIL Division II")).toEqual([["1", "3"], ["2", "4"]]);
  expect(() => parseTemplate("division,semifinal,region_a,region_b\nI,1,1,2\nI,2,2,3\n")).toThrow(/regions 1 to 4/);
  expect(() => parseTemplate("division,semifinal,region_a,region_b\nI,1,1,2\n")).toThrow(/semifinals 1 and 2/);
  expect(() => parseTemplate("division,semi,a,b\n")).toThrow(/header/);
  expect(() => parseTemplate("division,semifinal,region_a,region_b\nIII,1,1,2\n")).toThrow();
});

test("a private league never gets regions, only its own last-four chances", () => {
  const alignments = [{ league: "UIL", division: "I", region: "1", district: "1", school: "R1-1", sourceUrl: "", span: "2026-28", slug: "r1-1" }];
  const g = (round: string, home: string, away: string) => ({ league: "TAPPS", bracket: "TAPPS Division I", round, date: "2026-11-20", home, away, forfeit: false, neutral: true });
  const out = bracketTitleChances(table(), alignments, new Map(), "TAPPS Division I", [g("area", "R1-1", "R1-2"), g("area", "R1-3", "R1-4")]);
  expect(out.regions).toEqual([]);
  expect(out.state).toBeUndefined();
});
