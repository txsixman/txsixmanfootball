import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { LIVE_SCORES_URL } from "./live-route";

// The live score in place on Tonight and on the home page's My teams (ADR 0039): a game under way sits under In progress
// with its live line ("Unconfirmed", no leader); one the live read says is over (ADR 0043) sits under Final with its score
// and when it was read. My teams' next game shows the score from the school's side. Every request to Supabase is answered
// from a fixture; the game is one of tonight's, from the loaders, so the test follows the data.
test.use({ serviceWorkers: "block" });

const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "POST, OPTIONS" };
const AS_OF = String.raw`as of \d{1,2}:\d{2} (AM|PM) CT`;

type Fixture = { id: string; kickoff: string; home: string; away: string; key: string; homeSlug: string; awaySlug: string; homeProgram?: string };
let cached: Promise<Fixture | undefined> | undefined;
/** Tonight's earliest game with a kickoff and no score yet (lib/tonight.ts), or none. */
const fixture = () =>
  (cached ??= (async () => {
    const was = process.cwd();
    process.chdir(path.join(__dirname, ".."));
    try {
      const { loadAlignments } = await import("../lib/alignments");
      const { loadNight } = await import("../lib/tonight");
      const { liveKey } = await import("../lib/live-scores");
      const { slugify } = await import("../lib/slug");
      const alignments = await loadAlignments();
      const games = (await loadNight()).orgs.flatMap((o) => o.rounds.flatMap((r) => r.games));
      const g = games.filter((x) => x.state === "later" && x.kickoff).sort((a, b) => a.kickoff!.localeCompare(b.kickoff!))[0];
      return g && {
        id: g.id, kickoff: g.kickoff!, home: g.home, away: g.away, key: liveKey(g.date, g.home, g.away),
        homeSlug: slugify(g.home), awaySlug: slugify(g.away), homeProgram: alignments.find((a) => a.school === g.home)?.slug,
      };
    } finally {
      process.chdir(was);
    }
  })());

const NONE = "no game tonight with a kickoff and no score yet";
const skipped = (why: string) => {
  console.warn(`skipped: ${why}`);
  return why;
};

/** Home 28, away 14, read half an hour after kickoff, with the page's clock there too. */
async function serveLive(page: Page, f: Fixture, over: Record<string, unknown> = {}) {
  const at = new Date(Date.parse(f.kickoff) + 30 * 60_000);
  const row = { game_key: f.key, home: f.homeSlug, away: f.awaySlug, home_score: 28, away_score: 14, period: null, read_at: at.toISOString(), ...over };
  await page.clock.install({ time: at });
  await page.route(LIVE_SCORES_URL, (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    return route.fulfill({ status: 200, headers: CORS, contentType: "application/json", body: JSON.stringify([row]) });
  });
}

const follow = (page: Page, slug: string) => page.addInitScript((s) => localStorage.setItem("followed-programs", JSON.stringify([s])), slug);
const noLeader = async (text: string) => expect(text.toLowerCase().replace(/win probability/g, "")).not.toMatch(/\b(winner|wins?|won|leading|leads?)\b/);

test("Tonight: a game under way sits under In progress with its live score, Unconfirmed and no leader", async ({ page }) => {
  const f = await fixture();
  if (!f) return test.skip(true, skipped(NONE));
  await serveLive(page, f);
  await page.goto("/scores/tonight");
  const row = page.locator(`[data-group="in-progress"] li[data-game="${f.id}"]`);
  await expect(row.locator("[data-live-score]")).toContainText("14–28", { timeout: 15_000 });
  await expect(row).toContainText(/Unconfirmed/);
  await expect(page.locator(`[data-group="up-next"] li[data-game="${f.id}"]`)).toHaveCount(0);
  await noLeader(await row.innerText());
});

test("Tonight: a game the live read says is over sits under Final with its score and when it was read", async ({ page }) => {
  const f = await fixture();
  if (!f) return test.skip(true, skipped(NONE));
  await serveLive(page, f, { finished: true });
  await page.goto("/scores/tonight");
  const row = page.locator(`[data-group="final"] li[data-game="${f.id}"]`);
  await expect(row).toContainText(new RegExp(`Final[\\s\\S]*${f.away} 14, ${f.home} 28 · ${AS_OF}`), { timeout: 15_000 });
  await expect(row).not.toContainText(/Unconfirmed|Score reported/);
});

test("My teams: the next game, while under way, shows its live score from the school's side, dashed", async ({ page }) => {
  const f = await fixture();
  if (!f?.homeProgram) return test.skip(true, skipped(f ? "the home team has no program page" : NONE));
  await follow(page, f.homeProgram);
  await serveLive(page, f);
  await page.goto("/");
  const card = page.getByRole("region", { name: "My teams" }).getByRole("listitem");
  await expect(card.locator("[data-live-score]").first()).toHaveText(new RegExp(`^Live · 28-14 · ${AS_OF} · Unconfirmed$`), { timeout: 20_000 });
  await expect(card.locator(".decoration-dashed")).toHaveText(/^28-14/);
  await expect(card).not.toContainText("Projected"); // the live line takes its place
  await noLeader(await card.innerText());
});

test("My teams: a next game the live read says is over shows Final with its score, solid", async ({ page }) => {
  const f = await fixture();
  if (!f?.homeProgram) return test.skip(true, skipped(f ? "the home team has no program page" : NONE));
  await follow(page, f.homeProgram);
  await serveLive(page, f, { finished: true });
  await page.goto("/");
  const card = page.getByRole("region", { name: "My teams" }).getByRole("listitem");
  await expect(card.locator("[data-live-score]").first()).toHaveText(new RegExp(`^Final · 28-14 · ${AS_OF}$`), { timeout: 20_000 });
  await expect(card.locator(".decoration-dashed")).toHaveCount(0);
});
