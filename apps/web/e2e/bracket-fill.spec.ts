import { expect, test } from "@playwright/test";
import { programFor, loadAlignments } from "../lib/alignments";
import { sideText } from "../lib/bracket-fill";
import { bracketHref, loadBrackets } from "../lib/brackets";
import { projectionText } from "../lib/projection";
import { noLiveScores } from "./live-route";

// Next-round games the bracket sets before any site lists them (ADR 0047): "Team vs winner of X–Y", or both teams with the
// projection. The data changes every week, so the expected rows come from the same data the pages are built from.
noLiveScores(test);

const BETTING = /\b(spreads?|odds|lines?|bets?|betting|underdogs?|favou?rites?)\b/i;
// "winner of X–Y" names a game not yet played, never who won one; any other winner word is wrong.
const CLAIMS_A_RESULT = /\b(won|beat|beats|defeated|wins)\b|\bwinner\b(?! of )/i;
const PROJECTED = /^Projected: .+ by (\d+|45\+) · (>99|<1|\d+)% chance to win$/;

async function built() {
  const [brackets, alignments] = await Promise.all([loadBrackets(), loadAlignments()]);
  return brackets.flatMap((b) =>
    b.rounds.flatMap((r) =>
      r.built.map((g) => ({
        bracket: b, round: r, text: g.sides.map(sideText).join(" vs "), projected: g.projection && projectionText(g.projection),
        teams: g.sides.flatMap((s) => ("team" in s ? [programFor(alignments, s.team, b.league)?.slug].filter(Boolean) : [])) as string[],
      })),
    ),
  );
}

test("each bracket page shows the games its bracket sets, with no date or site, and a projection once both teams are known", async ({ page }) => {
  const rows = await built();
  test.skip(!rows.length, "no next-round game is waiting on a listing today");
  for (const [href, list] of Map.groupBy(rows, (r) => bracketHref(r.bracket.name))) {
    await page.goto(href);
    const shown = page.locator("li[data-built]");
    await expect(shown).toHaveCount(list.length);
    for (const r of list) {
      const row = shown.filter({ hasText: r.text });
      await expect(row).toHaveCount(1);
      await expect(row).toContainText("Next game · date and site not listed yet");
      if (r.projected) await expect(row.getByText(PROJECTED)).toHaveText(`Projected: ${r.projected}`);
      else await expect(row).not.toContainText("Projected:");
      const text = (await row.textContent()) ?? "";
      expect(text).not.toMatch(CLAIMS_A_RESULT);
      expect(text).not.toMatch(BETTING);
      for (const slug of r.teams) await expect(row.locator(`a[href="/programs/${slug}"]`)).toHaveCount(1);
    }
    await expect(page.getByRole("heading", { level: 2, name: new RegExp(`${list[0].round.label}.*more set by the bracket`) })).toHaveCount(1);
  }
});

test("a team with a next game the bracket sets sees it on its page, in place of the 'if it advances' guess", async ({ page }) => {
  const rows = (await built()).filter((r) => r.teams.length);
  test.skip(!rows.length, "no next-round game is waiting on a listing today");
  const r = rows[0];
  await page.goto(`/programs/${r.teams[0]}`);
  const path = page.getByRole("region", { name: "Path to the final" });
  const row = path.locator("li[data-built]");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(r.round.label);
  await expect(row).toContainText("Next game · date and site not listed yet");
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
    for (const r of list) await expect(next.locator("li[data-built]").filter({ hasText: r.text })).toHaveCount(1);
    expect((await next.textContent()) ?? "").not.toMatch(CLAIMS_A_RESULT);
  }
});
