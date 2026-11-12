import assert from "node:assert/strict";
import { test } from "node:test";
import { infoboxField, namedFor, plain, splitColors, supports } from "./wikipedia.mjs";

const SAMPLE = `{{Infobox school
| name = Alpha High School
| colors = {{color box|#800000}} Maroon<br />{{color box|white}} White<ref>{{cite web|url=x}}</ref>
| mascot = [[Eagle]]s
| nickname = {{nowrap|Fighting Eagles}}
| athletics_colors = {{plainlist|
* Navy
* [[Old gold|Old Gold]]
}}
| team_name = <!-- fill in -->
| city = Alpha, [[Texas]]
}}`;

test("infobox values come out as plain text", () => {
  assert.equal(infoboxField(SAMPLE, ["colors", "colours"]), "Maroon, White");
  assert.equal(infoboxField(SAMPLE, ["mascot"]), "Eagles");
  assert.equal(infoboxField(SAMPLE, ["nickname"]), "Fighting Eagles");
  assert.equal(infoboxField(SAMPLE, ["athletics_colors"]), "Navy, Old Gold");
  assert.equal(infoboxField(SAMPLE, ["team_name"]), null);
  assert.equal(infoboxField(SAMPLE, ["motto"]), null);
  assert.equal(plain("[[Royal blue|Royal Blue]] &nbsp;& '''Gold'''"), "Royal Blue & Gold");
});

test("a value Wikipedia cites to MaxPreps is not used", () => {
  assert.equal(infoboxField("| colors = Green, Gold<ref name=maxpreps>{{cite web|url=https://www.maxpreps.com/x}}</ref>", ["colors"]), null);
});

test("the audit keeps facts the article states and drops ones it does not, or that cite MaxPreps", () => {
  const body = "{{Infobox school district\n| name = Alpha ISD\n}}\n\nThe [[Alpha Bulldogs]] wear maroon and white.\n\nThe team won in 1990.<ref>maxpreps.com</ref>";
  assert.equal(supports(body, ["mascot"], ["Bulldogs"]), true);
  assert.equal(supports(body, ["colors"], ["maroon", "white"]), true);
  assert.equal(supports(body, ["colors"], ["maroon", "gold"]), false);
  assert.equal(supports(`${body}\n\nThe Alpha Eagles play.<ref>maxpreps</ref>`, ["mascot"], ["Eagles"]), false);
  assert.equal(supports(SAMPLE, ["mascot"], ["Eagles"]), true);
});

test("a second infobox's uncited value is used when the first cites MaxPreps", () => {
  const two = "| colors = Blue, white<ref name=maxpreps>x</ref>\n| mascot = Bulldogs<ref name=maxpreps />\n}}\n{{Infobox school\n| colors = Blue & White\n| mascot = Bulldog\n}}";
  assert.equal(infoboxField(two, ["colors"]), "Blue & White");
  assert.equal(infoboxField(two, ["mascot"]), "Bulldog");
});

test("a comment holding a pipe does not cut a field short", () => {
  assert.equal(infoboxField("| colors = <!-- or | colours = --> Red, White\n| mascot = Hawks", ["colors"]), "Red, White");
});

test("an article must be named for the school itself", () => {
  assert.equal(namedFor("Morgan High School", "Morgan"), true);
  assert.equal(namedFor("Morgan Independent School District", "Morgan"), true);
  assert.equal(namedFor("Morgan Mill Independent School District", "Morgan"), false);
  assert.equal(namedFor("Temple Christian School (Fort Worth, Texas)", "Temple Christian School"), true);
  assert.equal(namedFor("St. Mary's University, Texas", "St. Mary's"), false);
});

test("color text splits into names", () => {
  assert.deepEqual(splitColors("Maroon, White & Gold"), ["maroon", "white", "gold"]);
  assert.deepEqual(splitColors("Navy Blue and Old Gold"), ["navy blue", "old gold"]);
  assert.deepEqual(splitColors("Black / Red"), ["black", "red"]);
});
