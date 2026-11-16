import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

// Gate G2's cut rule (ADR 0073): what the registry knows it is missing is counted and shown on /programs, under its
// league, apart from the programs (no program link, no organization tab), straight from not-listed.csv.
const rows = readFileSync(path.join(__dirname, "../../../data/seed/private-2026/not-listed.csv"), "utf8")
  .trim()
  .split("\n")
  .slice(1)
  .map((l) => l.split(","))
  .map(([league, school, reason]) => ({ league, school, reason }));

test("Programs shows each league and team not yet listed, apart from the programs", async ({ page }) => {
  await page.goto("/programs", { waitUntil: "networkidle" });
  const section = page.getByRole("region", { name: "Not yet listed" });
  await expect(section).toBeVisible();
  for (const r of rows) {
    const card = section.getByRole("article").filter({ has: page.getByRole("heading", { name: new RegExp(`^${r.league}\\b`) }) });
    await expect(card).toHaveCount(1);
    await expect(card).toContainText(r.school || r.reason);
  }
  // Nothing in it is a link: a team not yet listed has no program page.
  await expect(section.getByRole("link")).toHaveCount(0);
  // The leagues with no list get no jump link among the organizations.
  const jump = page.getByRole("navigation", { name: "Jump to an organization" });
  for (const league of new Set(rows.filter((r) => !r.school).map((r) => r.league))) await expect(jump.getByRole("link", { name: new RegExp(`^${league}\\b`) })).toHaveCount(0);
});
