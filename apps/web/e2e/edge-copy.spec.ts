import { expect, test } from "@playwright/test";

// The plain-words "what this site has" line on /scores and on a program page (lib/intros.ts): shown, and free of betting
// words, source names and a named winner.
const BANNED = /\b(spreads?|odds|lines?|bets?|betting|underdogs?|favou?rites?|locks?)\b|maxpreps|hudl|calpreps|sixmanfootball|dave campbell/i;

test("/scores says what the site has", async ({ page }) => {
  await page.goto("/scores");
  const line = page.getByText(/^Live scores on game nights, a projected margin/);
  await expect(line).toBeVisible();
  await expect(line).toContainText("Free, no sign-in.");
  expect(await line.innerText()).not.toMatch(BANNED);
});

test("a program page says what the site has for that school", async ({ page }) => {
  await page.goto("/programs/jayton");
  const line = page.getByText(/^Jayton's scores through every game night/);
  await expect(line).toBeVisible();
  await expect(line).toContainText("projected margin and chance to win for each game still to play");
  expect(await line.innerText()).not.toMatch(BANNED);
});
