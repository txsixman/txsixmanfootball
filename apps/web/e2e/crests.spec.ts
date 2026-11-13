import { expect, test, type Page } from "@playwright/test";
import { noLiveScores } from "./live-route";
import { readFileSync } from "node:fs";
import path from "node:path";

// No live-score request reaches the network (e2e/live-route.ts).
noLiveScores(test);

// Every team name beside a school's crest (ADR 0006, ADR 0016): the logo when it is at most 1.6 times wider than tall,
// else the school's initials badge. The expectation comes from data/seed/schools/identity.json, so a new logo that is
// too wide changes nothing here but its own row.

const SEED = path.join(__dirname, "../../../data/seed");
const { schools } = JSON.parse(readFileSync(path.join(SEED, "schools/identity.json"), "utf8")) as {
  schools: Record<string, { logo: { file?: string; aspect?: number } | null }>;
};
const hasLogoInSlot = (slug: string) => {
  const logo = schools[slug]?.logo;
  return Boolean(logo?.file) && (logo?.aspect ?? 1) <= 1.6;
};
const slugify = (name: string) => name.toLowerCase().replace(/'/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** For each link to a program page in a list item, whether its crest is a logo image or a badge. */
async function crestsOf(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLAnchorElement>("main li a[href^='/programs/']")].map((a) => {
      // The crest is inside the link, or beside it in the nearest row (a span.flex) that has one.
      let scope: Element = a;
      while (!scope.querySelector("img, span[aria-hidden='true']") && scope.parentElement && scope.tagName !== "LI") scope = scope.parentElement;
      return {
        slug: a.getAttribute("href")!.split("/")[2],
        img: scope.querySelector("img[src^='/logos/']") !== null,
        badge: scope.querySelector("span[aria-hidden='true']:not(.w-10)") !== null,
      };
    }),
  );
}

async function expectCrestsMatchData(page: Page, url: string) {
  expect((await page.goto(url, { waitUntil: "networkidle" }))?.status(), url).toBe(200);
  const rows = await crestsOf(page);
  expect(rows.length, `${url}: program links with a crest`).toBeGreaterThan(0);
  for (const r of rows) {
    if (hasLogoInSlot(r.slug)) expect(r.img, `${url}: ${r.slug} shows its logo`).toBe(true);
    else expect(r.img, `${url}: ${r.slug} (no logo, or wider than 1.6) shows initials, not a logo`).toBe(false);
  }
  return rows;
}

test("scores board: each team line has a crest slot, logos where the school has one", async ({ page }) => {
  await page.goto("/scores", { waitUntil: "networkidle" });
  const lines = page.locator("li[data-game] .h-7");
  const count = await lines.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i += 1) {
    const slot = lines.nth(i).locator("> span").first();
    // the slot holds a logo image, or an initials badge
    expect(await slot.locator("img[src^='/logos/'], span[aria-hidden='true']").count(), `team line ${i}`).toBeGreaterThan(0);
  }
  expect(await page.locator("li[data-game] img[src^='/logos/']").count()).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
});

test("results week: crests match the data", async ({ page }) => {
  const rows = await expectCrestsMatchData(page, "/results");
  expect(rows.some((r) => r.img)).toBe(true);
});

test("playoffs bracket: crests match the data", async ({ page }) => {
  await expectCrestsMatchData(page, "/playoffs");
});

test("records: a crest beside each team", async ({ page }) => {
  const rows = await expectCrestsMatchData(page, "/records");
  expect(rows.some((r) => r.img)).toBe(true);
});

test("program page: big crest takes a wide logo; schedule, most played and district lines carry crests", async ({ page }) => {
  // A district where some schools' logos are wider than 1.6 (initials in a list) and some are not (logos).
  const rows = readFileSync(path.join(SEED, "uil-2026-28/alignments.csv"), "utf8").trim().split("\n").slice(1).map((l) => l.split(","));
  const byDistrict = Map.groupBy(rows, (c) => c.slice(0, 4).join("|"));
  const group = [...byDistrict.values()].find((g) => {
    const slugs = g.map((c) => slugify(c[4]));
    return slugs.some((s) => schools[s]?.logo && !hasLogoInSlot(s)) && slugs.filter(hasLogoInSlot).length >= 2;
  });
  expect(group, "a district with both wide and narrow logos").toBeDefined();
  const slugs = group!.map((c) => slugify(c[4]));
  const home = slugs.find(hasLogoInSlot)!;
  const found = await expectCrestsMatchData(page, `/programs/${home}`);
  expect(found.some((r) => r.img)).toBe(true);
  expect(found.some((r) => !r.img && r.badge)).toBe(true); // the wide-logo neighbor shows initials

  // The big crest (program page) draws logos up to 4.8 wide: Community Christian's is 4.36.
  await page.goto("/programs/community-christian", { waitUntil: "networkidle" });
  await expect(page.locator("header img[src='/logos/community-christian.png']")).toBeVisible();
});
