import path from "node:path";
import { expect, test } from "@playwright/test";
import { programFor, loadAlignments } from "../lib/alignments";
import { sideText } from "../lib/bracket-fill";
import { bracketHref, loadBrackets } from "../lib/brackets";
import { gameDay } from "../lib/game-day";
import { projectionText } from "../lib/projection";
import { noLiveScores } from "./live-route";

// Next-round games the bracket sets before any site lists them (ADR 0047): "Team vs winner of X–Y", or both teams with the
// projection. The data changes every week, so the expected rows come from the same data the pages are built from.
noLiveScores(test);

const BETTING = /\b(spreads?|odds|lines?|bets?|betting|underdogs?|favou?rites?)\b/i;
// "winner of X–Y" names a game not yet played, never who won one; any other winner word is wrong.
const CLAIMS_A_RESULT = /\b(won|beat|beats|defeated|wins)\b|\bwinner\b(?! of )/i;
const PROJECTED = /^Projected: .+ by (\d+|45\+) · (>99|<1|\d+)% chance to win$/;

/** The loaders read ../../data from the working directory; the tests run from the repo root (as e2e/upcoming.ts does). */
async function built() {
  const was = process.cwd();
  process.chdir(path.join(__dirname, ".."));
  try {
    return await builtRows();
  } finally {
    process.chdir(was);
  }
}

async function builtRows() {
  const [brackets, alignments] = await Promise.all([loadBrackets(), loadAlignments()]);
  return brackets.flatMap((b) =>
    b.rounds.flatMap((r) =>
      r.built.map((g) => ({
        bracket: b, round: r, text: g.sides.map(sideText).join(" vs "), sides: g.sides.map(sideText), projected: g.projection && projectionText(g.projection),
        // The day, and the site or "Site not listed yet", once the morning read found the pairing (ADR 0067).
        when: g.date ? `Next game · ${gameDay(g.date)}` : "Next game · date and site not listed yet", site: g.date ? (g.site ? `Site: ${g.site}` : "Site not listed yet") : undefined,
        // The site's street address and a Directions link once the read has it (ADR 0066), as a listed game's page shows.
        directions: Boolean(g.date && g.site && g.address),
        teams: g.sides.flatMap((s) => ("team" in s ? [programFor(alignments, s.team, b.league)?.slug].filter(Boolean) : [])) as string[],
      })),
    ),
  );
}

test("each bracket page shows the games its bracket sets, with their day and site once read, and a projection once both teams are known", async ({ page }) => {
  const rows = await built();
  test.skip(!rows.length, "no next-round game is waiting on a listing today");
  for (const [href, list] of Map.groupBy(rows, (r) => bracketHref(r.bracket.name))) {
    await page.goto(href);
    const shown = page.locator("li[data-built]");
    await expect(shown).toHaveCount(list.length);
    for (const r of list) {
      // Each side on its own line, as a listed game's two teams are.
      const row = shown.filter({ hasText: r.sides[0] }).filter({ hasText: r.sides[1] });
      await expect(row).toHaveCount(1);
      await expect(row).toContainText(r.when);
      if (r.site) await expect(row).toContainText(r.site);
      await expect(row.getByRole("link", { name: /^Directions to / })).toHaveCount(r.directions ? 1 : 0);
      if (r.projected) await expect(row.getByText(PROJECTED)).toHaveText(`Projected: ${r.projected}`);
      else await expect(row).not.toContainText("Projected:");
      const text = (await row.textContent()) ?? "";
      expect(text).not.toMatch(CLAIMS_A_RESULT);
      expect(text).not.toMatch(BETTING);
      for (const slug of r.teams) await expect(row.locator(`a[href="/programs/${slug}"]`)).toHaveCount(1);
    }
    await expect(page.getByRole("heading", { level: 2, name: new RegExp(`${list[0].round.label}.*set by the bracket`) })).toHaveCount(1);
  }
});

test("a team with a next game the bracket sets sees it on its page, in place of the 'if it advances' guess", async ({ page }) => {
  const rows = (await built()).filter((r) => r.teams.length);
  test.skip(!rows.length, "no next-round game is waiting on a listing today");
  const r = rows[0];
  await page.goto(`/programs/${r.teams[0]}`);
  const path = page.getByRole("region", { name: "Path to the State Championship" });
  const row = path.locator("li[data-built]");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(r.round.label);
  await expect(row).toContainText(r.when);
  if (r.site) await expect(row).toContainText(r.site);
  expect((await row.textContent()) ?? "").not.toMatch(CLAIMS_A_RESULT);
  if (r.projected) await expect(row).toContainText(`Projected: ${r.projected}`);
  await expect(path).not.toContainText("If it advances");
});

test("Scores lists the next games under each organization's button", async ({ page }) => {
  const rows = await built();
  test.skip(!rows.length, "no next-round game is waiting on a listing today");
  await page.goto("/scores", { waitUntil: "networkidle" });
  for (const [league, list] of Map.groupBy(rows, (r) => r.bracket.league)) {
    const button = page.getByRole("group", { name: "Show games from" }).getByRole("button", { name: league, exact: true });
    if (await button.count()) await button.click();
    const next = page.getByRole("region", { name: "Next games" });
    await expect(next.locator("li[data-built]")).toHaveCount(list.length);
    for (const r of list) {
      const row = next.locator("li[data-built]").filter({ hasText: r.text });
      await expect(row).toHaveCount(1);
      await expect(row.getByRole("link", { name: /^Directions to / })).toHaveCount(r.directions ? 1 : 0);
    }
    expect((await next.textContent()) ?? "").not.toMatch(CLAIMS_A_RESULT);
    // "Later" in the jump bar counts these too: they are this week's games as much as the listed ones.
    const later = await page.locator("#later li").count();
    await expect(page.getByRole("navigation", { name: "Jump to" }).getByRole("link", { name: /^Later/ })).toContainText(String(later + list.length));
  }
});
