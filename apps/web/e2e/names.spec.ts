import { expect, test } from "@playwright/test";
import path from "node:path";
import { loadAlignments, programFor, slugify, uniquePrograms, type Alignment } from "../lib/alignments";

// G2.9: a team name from any game file finds its program by slug, not by exact string, and a school listed in two
// leagues resolves the same way every time.

/** The loaders read ../../data from the working directory; the tests run from the repo root. */
async function inWeb<T>(run: () => Promise<T>): Promise<T> {
  const was = process.cwd();
  process.chdir(path.join(__dirname, ".."));
  try {
    return await run();
  } finally {
    process.chdir(was);
  }
}

const row = (league: string, school: string): Alignment => ({
  league, division: "Six-Man", region: "", district: "0", school, sourceUrl: "", span: "2026", slug: slugify(school),
});

test("case, apostrophe, spacing and punctuation differences reach the same program", async () => {
  const all = await inWeb(loadAlignments);
  const real = all.find((a) => /\s/.test(a.school))!;
  const variants = [real.school, real.school.toUpperCase(), real.school.toLowerCase(), `  ${real.school.replace(/ /g, "  ")} `, real.school.replace(/ /g, "-")];
  for (const v of variants) expect(programFor(all, v)?.slug, v).toBe(real.slug);
  expect(programFor(all, "Not A Real School")).toBeUndefined();

  const synthetic = [row("UIL", "O'Donnell")];
  for (const v of ["O'Donnell", "ODonnell", "o'donnell", " O'Donnell "]) expect(programFor(synthetic, v)?.school, v).toBe("O'Donnell");
});

test("a school in two leagues resolves to the page's league, else the first listed, whatever the call order", () => {
  const both = [row("TCAF", "Grayson Christian"), row("TAIAO", "Grayson Christian")];
  expect(programFor(both, "Grayson Christian", "TAIAO")?.league).toBe("TAIAO");
  expect(programFor(both, "grayson christian", "TCAF")?.league).toBe("TCAF");
  expect(programFor(both, "Grayson Christian")?.league).toBe("TCAF");
  expect(programFor(both, "Grayson Christian", "UIL")?.league).toBe("TCAF");
  expect(programFor([...both].reverse(), "Grayson Christian")?.league).toBe("TAIAO");
  expect(uniquePrograms(both).map((a) => a.league)).toEqual(["TCAF"]);
});

test("program static params have no duplicate slug", async () => {
  const all = await inWeb(loadAlignments);
  const slugs = uniquePrograms(all).map((a) => a.slug);
  expect(new Set(slugs).size).toBe(slugs.length);
  expect(slugs.length).toBeGreaterThan(250);
  // Every slug in the data still has a page.
  expect(new Set(slugs)).toEqual(new Set(all.map((a) => a.slug)));
});
