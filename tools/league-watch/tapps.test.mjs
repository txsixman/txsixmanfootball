import assert from "node:assert/strict";
import { test } from "node:test";
import { checkTapps, parseTapps, robotsAllows, toCsv } from "./tapps.mjs";

const SAMPLE = `Alignment
District
Select a District
District 1
Football - 6 Man
Football - 6 Man - Division I - District 1
Alpha School-Town *
Beta Academy
Football - 6 Man - Division I - Independent
Gamma Prep
Football - 6 Man - Division IV - Non-Aligned
Delta High School-Somewhere
`;

test("the widget's text becomes rows, starting at the first division heading", () => {
  assert.deepEqual(parseTapps(SAMPLE), [
    { division: "I", district: "1", school: "Alpha School-Town", marked: true },
    { division: "I", district: "1", school: "Beta Academy", marked: false },
    { division: "I", district: "Independent", school: "Gamma Prep", marked: false },
    { division: "IV", district: "Non-Aligned", school: "Delta High School-Somewhere", marked: false },
  ]);
});

test("a read that looks wrong is refused, not written", () => {
  assert.throws(() => checkTapps(parseTapps(SAMPLE)), /4 schools; expected 40 to 150/);
  const many = Array.from({ length: 45 }, (_, i) => ({ division: ["I", "II", "III"][i % 3], district: String((i % 5) + 1), school: `School ${i}` }));
  assert.doesNotThrow(() => checkTapps(many));
  assert.throws(() => checkTapps([...many, { ...many[0] }]), /listed twice: School 0/);
  assert.throws(() => checkTapps([...many, { division: "I", district: "9", school: "Footer, Inc" }]), /has 1 school[\s\S]*comma in a name/);
});

test("rows become the seed CSV with the page as the source", () => {
  assert.equal(
    toCsv(parseTapps(SAMPLE)).split("\n")[1],
    "TAPPS,I,,1,Alpha School-Town,https://tapps.biz/home/tapps-26-28-alignment/",
  );
});

test("robots.txt is honoured", () => {
  assert.equal(robotsAllows("User-agent: *\nDisallow:\n", "/home/tapps-26-28-alignment/"), true);
  assert.equal(robotsAllows("User-agent: *\nDisallow: /home/\n", "/home/tapps-26-28-alignment/"), false);
  assert.equal(robotsAllows("User-agent: Googlebot\nDisallow: /\n", "/home/x/"), true);
  assert.equal(robotsAllows("User-agent: Googlebot\nUser-agent: *\nDisallow: /\n", "/home/x/"), false);
  // Wildcards and anchors; another agent's name; our own agent's group.
  assert.equal(robotsAllows("User-agent: *\nDisallow: /*.php$\n", "/admin.php"), false);
  assert.equal(robotsAllows("User-agent: *\nDisallow: /*.php$\n", "/admin.php/x"), true);
  assert.equal(robotsAllows("User-agent: *\nDisallow: /posts/\n", "/threads/x/"), true);
  assert.equal(robotsAllows("User-agent: ClaudeBot\nDisallow: /\n", "/scores/", "TXSixManFootballBot"), true);
  assert.equal(robotsAllows("User-agent: TXSixManFootballBot\nDisallow: /scores/\n", "/scores/", "TXSixManFootballBot"), false);
  assert.equal(robotsAllows("User-agent: Project80x40-alignment-reader\nDisallow: /\n", "/home/x/"), false);
});
