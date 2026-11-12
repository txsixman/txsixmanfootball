import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { demoGames } from "../lib/demo-games";
import { normalCdf, project, projectionText } from "../lib/projection";
import { chancesFor } from "../lib/title-chances";
import { movement } from "../lib/ratings";

const SHOTS = path.join(__dirname, ".results", "shots");

async function checkPage(page: Page, url: string, stem: string) {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  const response = await page.goto(url, { waitUntil: "networkidle" });
  expect(response?.status()).toBe(200);
  await page.evaluate(() => document.fonts.ready);
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${stem}-fold.png`) });
  await page.screenshot({ path: path.join(SHOTS, `${stem}-full.png`), fullPage: true });

  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);
  const m = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    short: [...document.querySelectorAll("main a, main button, main input")].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height < 44 && !el.matches("input");
    }).length,
  }));
  expect(m).toEqual({ overflow: 0, short: 0 });
  expect(errors).toEqual([]);
}

test("the scoreboard passes on this screen size", async ({ page }, info) => {
  await checkPage(page, "/scores", `scores-${info.project.name}`);
});

test("the sample scoreboard passes on this screen size", async ({ page }, info) => {
  await checkPage(page, "/scores/sample", `sample-${info.project.name}`);
});

test("the rankings page and the sample rankings pass", async ({ page }, info) => {
  await checkPage(page, "/rankings", `rankings-${info.project.name}`);
  await checkPage(page, "/rankings/sample", `rankings-sample-${info.project.name}`);
  const rows = page.getByRole("table").getByRole("row");
  await expect(rows.nth(1)).toContainText("Red Bluff Creek");
  await expect(rows.nth(1)).toContainText("+");
  await expect(page.getByRole("table")).not.toContainText("Salt Fork"); // forfeit only: in no rating
});

test("a rating on few games is marked, and the method page passes (backlog item 8)", async ({ page }, info) => {
  await page.goto("/rankings/sample");
  await expect(page.getByRole("table").getByText(/^\d games?$/).first()).toBeVisible();
  await checkPage(page, "/rankings/how", `rankings-how-${info.project.name}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("How the rankings work");
  await expect(page.locator("body")).not.toContainText(/\b(spread|odds|line|bet)s?\b|maxpreps|source/i);
  // The track record: each band's favorites should win about as often as the band says, within a loose margin.
  const track = page.getByRole("region", { name: "How well it picks games" });
  const rows = track.getByRole("table").locator("tbody tr");
  expect(await rows.count()).toBeGreaterThanOrEqual(4);
  for (const row of await rows.all()) {
    const [band, games, won] = await row.locator("th, td").allTextContents();
    const from = band.startsWith("Over") ? 99 : Number(band.split(" ")[0]);
    expect(Number(games.replace(/,/g, "")), band).toBeGreaterThan(30);
    expect(Number(won.replace("%", "")), band).toBeGreaterThanOrEqual(from - 10);
  }
  await page.goto("/rankings");
  await page.getByRole("link", { name: "How the rankings work" }).click();
  await expect(page).toHaveURL(/\/rankings\/how$/);
});

test("rankings have Overall, Division I and Division II tabs, each ranked on its own", async ({ page }, info) => {
  const count = async (url: string) => {
    await page.goto(url);
    return page.getByRole("table").getByRole("row").count();
  };
  const [overall, d1, d2] = [await count("/rankings"), await count("/rankings/division-1"), await count("/rankings/division-2")];
  expect(d1).toBeGreaterThan(40);
  expect(d2).toBeGreaterThan(40);
  expect(overall).toBe(d1 + d2 - 1); // all of UIL is Division I plus Division II (one header row each); no other organization
  await checkPage(page, "/rankings/division-1", `rankings-d1-${info.project.name}`);
  const tabs = page.getByRole("navigation", { name: "Rankings by division" });
  await expect(tabs.getByRole("link", { name: "Division I", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("table").getByRole("row").nth(1)).toContainText(/^1/);
  await expect(page.getByRole("table")).not.toContainText("Follett"); // Division II
  await tabs.getByRole("link", { name: "Division II" }).click();
  await expect(page).toHaveURL(/\/rankings\/division-2$/, { timeout: 20_000 }); // a dev server compiles the page on first visit
  await expect(page.getByRole("table")).not.toContainText("Boys Ranch"); // Division I
  expect((await page.goto("/rankings/division-3"))?.status()).toBe(404);
});

test("the home page ranks each organization on its own, UIL by division, and shows the reigning champions", async ({ page }, info) => {
  await checkPage(page, "/", `home-${info.project.name}`);
  const rankings = page.getByRole("region", { name: "Rankings", exact: true });
  for (const [name, n] of [["UIL Division I", 5], ["UIL Division II", 5], ["TAPPS", 3], ["TAIAO", 3]] as const) {
    const list = rankings.getByRole("region", { name, exact: true }).getByRole("listitem");
    await expect(list, name).toHaveCount(n);
    // Ranks restart in every block (ADR 0012): no all-league rank numbers.
    expect((await list.evaluateAll((items) => items.map((li) => li.firstElementChild?.textContent))).map(Number)).toEqual(
      Array.from({ length: n }, (_, i) => i + 1),
    );
  }
  await expect(page.getByRole("region", { name: /UIL state champions$/ }).getByRole("listitem")).toHaveCount(2);
  await page.getByRole("link", { name: "Full UIL Division II rankings" }).click();
  await expect(page).toHaveURL(/\/rankings\/division-2$/);
});

test("a program page shows its ranking", async ({ page }) => {
  await page.goto("/programs/jayton");
  await expect(page.getByRole("link", { name: /^#\d+ in Division I$/ })).toHaveAttribute("href", "/rankings/division-1");
  const district = page.getByRole("link", { name: /^\d+(st|nd|rd|th) of \d+$/ });
  await expect(district).toHaveAttribute("href", /^\/standings#d-uil-division-i-/);
  await district.click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Standings");
  await page.goto("/programs/jayton");
  const games = page.getByRole("region", { name: "2026 games" });
  const opponent = games.getByRole("link").first();
  const name = (await opponent.textContent())!;
  await opponent.click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
  await page.goto("/programs/harvest-lantana"); // a TCAF school ranks within TCAF only
  await expect(page.getByRole("link", { name: /^#\d+ in TCAF$/ })).toHaveAttribute("href", "/rankings/tcaf");
});

test("a projection is the rating gap, plus home field off a neutral site, over the spread", () => {
  expect(normalCdf(0)).toBeCloseTo(0.5, 6);
  expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
  const table = { games: 2, home_field: 4, sigma: 20, teams: [
    { team: "Cedar Gap", rating: 10, rated: 2, won: 2, lost: 0, tied: 0 },
    { team: "Dry Wash", rating: -10, rated: 2, won: 0, lost: 2, tied: 0 },
  ] };
  expect(project(table, "Cedar Gap", "Dry Wash", true)).toMatchObject({ favorite: "Cedar Gap", margin: 20 });
  expect(project(table, "Dry Wash", "Cedar Gap", false)).toMatchObject({ favorite: "Cedar Gap", margin: 16 });
  expect(project(table, "Cedar Gap", "Salt Fork", true)).toBeUndefined(); // unrated
  expect(projectionText(project(table, "Cedar Gap", "Dry Wash", true)!)).toBe("Cedar Gap by 20 · 84% win probability");
  expect(projectionText({ favorite: "Cedar Gap", margin: 60, winProbability: 0.999 })).toBe("Cedar Gap by 45+ · >99% win probability");
});

test("standings list every district by district record, in three tabs", async ({ page }, info) => {
  await checkPage(page, "/standings", `standings-${info.project.name}`);
  const districts = page.getByRole("table");
  expect(await districts.count()).toBeGreaterThan(10);
  const first = districts.first().getByRole("row");
  const record = async (i: number) => (await first.nth(i).getByRole("cell").first().textContent())!.split("-").map(Number);
  const [top, second] = [await record(1), await record(2)];
  expect(top[0]).toBeGreaterThanOrEqual(second[0]); // more district wins first
  await page.getByRole("navigation", { name: "Standings by organization" }).getByRole("link", { name: "TAPPS" }).click();
  await expect(page).toHaveURL(/\/standings\/tapps$/);
  await expect(page.getByRole("heading", { level: 2 }).filter({ hasText: /^TAPPS/ }).first()).toBeVisible();
  await expect(page.getByRole("heading", { level: 2 }).filter({ hasText: /^UIL/ })).toHaveCount(0);
  await checkPage(page, "/standings/division-2", `standings-d2-${info.project.name}`);
});

test("the scoreboard shows one organization at a time, UIL first", async ({ page }) => {
  await page.goto("/scores", { waitUntil: "networkidle" });
  const filters = page.getByRole("group", { name: "Show games from" });
  await expect(filters.getByRole("button", { name: "UIL", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { level: 3 }).filter({ hasText: /TAPPS|TAIAO|TCAF/ })).toHaveCount(0);
  await filters.getByRole("button", { name: "TAIAO" }).click();
  await expect(page.getByRole("heading", { level: 3 }).filter({ hasText: /^UIL/ })).toHaveCount(0);
});

test("movement counts places since a week earlier, within the rows shown", () => {
  const row = (team: string, rating: number, was: number | null) => ({ team, rating, was, rated: 5, won: 3, lost: 2, tied: 0 });
  const moved = movement([row("Cedar Gap", 30, 10), row("Dry Wash", 20, 25), row("Salt Fork", 10, null)])!;
  expect(moved.get("Cedar Gap")).toBe(1); // 2nd a week ago, 1st now
  expect(moved.get("Dry Wash")).toBe(-1);
  expect(moved.get("Salt Fork")).toBe("new");
  expect(movement([{ team: "A", rating: 1, rated: 1, won: 1, lost: 0, tied: 0 }])).toBeUndefined();
});

test("the rankings show who moved since last week", async ({ page }) => {
  await page.goto("/rankings");
  await expect(page.getByRole("table").getByText(/^(up|down) \d+ since last week$/).first()).toBeAttached();
});

test("title chances: equal teams split evenly, a better team leads, and they sum to one", () => {
  const team = (name: string, rating: number) => ({ team: name, rating, rated: 9, won: 5, lost: 4, tied: 0 });
  const semis = (ratings: number[]) => {
    const names = ["Cedar Gap", "Dry Wash", "Salt Fork", "Red Bluff Creek"];
    const table = { games: 40, home_field: 4, sigma: 20, teams: names.map((n, i) => team(n, ratings[i])) };
    const game = (home: string, away: string) => ({ bracket: "Test Division I", round: "semifinal", home, away, played: false, neutral: true });
    return chancesFor(table, [game(names[0], names[1]), game(names[2], names[3])])!;
  };
  const even = semis([0, 0, 0, 0]);
  for (const c of even.chances) expect(c.chance).toBeCloseTo(0.25, 6);
  const tilted = semis([30, 0, 0, -10]);
  expect(tilted.chances[0].team).toBe("Cedar Gap");
  expect(tilted.chances.reduce((n, c) => n + c.chance, 0)).toBeCloseTo(1, 6);
});

test("the home page lists the closest games still to play, each organization on its own", async ({ page }) => {
  await page.goto("/");
  const watch = page.getByRole("region", { name: "Games to watch" });
  const blocks = watch.getByRole("region");
  expect(await blocks.count()).toBeGreaterThan(0);
  for (const block of await blocks.all()) {
    const org = (await block.getByRole("heading").textContent())!;
    const games = block.getByRole("listitem");
    expect(await games.count()).toBeLessThanOrEqual(3);
    // Every game in the block is that organization's (ADR 0012).
    for (const label of await games.locator(".text-muted").allTextContents()) expect(label.startsWith(`${org} `)).toBe(true);
    const margins = await games.evaluateAll((items) => items.map((li) => Number(/ by (\d+)/.exec(li.textContent ?? "")?.[1])));
    expect(margins).toEqual([...margins].sort((a, b) => a - b));
  }
  await watch.getByRole("listitem").first().getByRole("link").click();
  await expect(page).toHaveURL(/\/scores\/2026-/);
});

test("the home page shows title chances for brackets down to their last four", async ({ page }) => {
  await page.goto("/");
  const chances = page.getByRole("region", { name: "State title chances" });
  await expect(chances.getByRole("heading", { level: 3 }).first()).toContainText(/Semifinals|Final/);
  await expect(chances.getByRole("listitem").first()).toContainText(/(\d+|<1|>99)%$/);
});

test("upcoming playoff games show a projected margin and win probability, never betting words", async ({ page }) => {
  await page.goto("/scores");
  const projected = page.getByText(/^Projected: .+ by \d+\+? · (>99|\d{2})% win probability$/);
  expect(await projected.count()).toBeGreaterThan(5);
  await expect(page.locator("body")).not.toContainText(/\b(spread|odds|lines?|bets?|betting|favorite)\b/i);
});

test("old ratings and champions links land on the new pages", async ({ page }) => {
  await page.goto("/ratings");
  await expect(page).toHaveURL(/\/rankings$/);
  await page.goto("/ratings/how");
  await expect(page).toHaveURL(/\/rankings\/how$/);
  await page.goto("/champions");
  await expect(page).toHaveURL(/\/championships$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("State Championships");
});

test("state championships split Division I, Division II and the one-division years", async ({ page }) => {
  await page.goto("/championships");
  for (const [name, from] of [["Division I", "2006"], ["Division II", "2006"], ["One division", "1972"]]) {
    const section = page.getByRole("region", { name, exact: true });
    await expect(section, name).toContainText(`${from} to`);
    expect(await section.getByRole("row").count(), name).toBeGreaterThan(15);
  }
  await page.getByRole("navigation", { name: "Jump to" }).getByRole("link", { name: "Division II" }).click();
  await expect(page).toHaveURL(/#division-2$/);
});

test("the state championships page passes, lists every final and names no source (ADR 0010)", async ({ page }, info) => {
  await checkPage(page, "/championships", `championships-${info.project.name}`);
  await expect(page.getByRole("heading", { name: "Most state titles" })).toBeVisible();
  const finals = page.getByRole("table").getByRole("row");
  expect(await finals.count()).toBeGreaterThan(70);
  await expect(page.getByRole("link", { name: "Jayton" }).first()).toHaveAttribute("href", "/programs/jayton");
  await expect(page.getByText(/no state championship game/)).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/uiltexas|maxpreps|source/i);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
});

test("a program page lists its state finals", async ({ page }) => {
  await page.goto("/programs/jayton");
  const finals = page.getByRole("region", { name: "State championships" });
  await expect(finals).toContainText(/\d+ UIL state titles/);
  await expect(finals.getByRole("listitem").first()).toContainText(/Champion|Runner-up/);
});

test("a merged school's final shows on the program it became (ADR 0003)", async ({ page }) => {
  await page.goto("/championships");
  await expect(page.getByRole("link", { name: /^Wellman\s*now Wellman-Union$/ })).toHaveAttribute("href", "/programs/wellman-union");
  await page.goto("/programs/wellman-union");
  const finals = page.getByRole("region", { name: "State championships" });
  await expect(finals.getByRole("listitem").filter({ hasText: "1987" })).toContainText(/Runner-up.*as Wellman/);
});

test("matchup projects any two teams, home or neutral, and keeps the choice in the URL", async ({ page }, info) => {
  await checkPage(page, "/matchup", `matchup-${info.project.name}`);
  await page.goto("/programs/jayton", { waitUntil: "networkidle" });
  await page.getByRole("link", { name: "Compare" }).click();
  await expect(page).toHaveURL(/\/matchup\?a=jayton$/);
  await expect(page.getByRole("combobox", { name: "Team 1" })).toHaveValue("jayton");
  await page.getByRole("combobox", { name: "Team 2" }).selectOption("gordon");
  const result = page.getByRole("region", { name: "Projection" });
  await expect(result).toContainText(/(Jayton|Gordon) by \d+/);
  await expect(result).toContainText(/\d+% win probability|>99% win probability/);
  const neutral = await result.textContent();
  await page.getByRole("radio", { name: "At Gordon" }).check();
  await expect(page).toHaveURL(/a=jayton&b=gordon&at=b$/);
  await expect(result).not.toHaveText(neutral!); // home field moves it
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByRole("combobox", { name: "Team 2" })).toHaveValue("gordon");
  await expect(page.locator("body")).not.toContainText(/\b(spread|odds|lines?|bets?|betting)\b/i);
});

test("find a school narrows the programs list", async ({ page }) => {
  await page.goto("/programs", { waitUntil: "networkidle" });
  const box = page.getByRole("searchbox", { name: "Find a school" });
  await box.fill("jay");
  await expect(page.getByRole("status")).toHaveText("1 school matches");
  await page.getByRole("link", { name: "Jayton" }).click();
  await expect(page).toHaveURL(/\/programs\/jayton$/);
  await page.goBack();
  await page.getByRole("searchbox", { name: "Find a school" }).fill("zzzz");
  await expect(page.getByText(/No school matches/)).toBeVisible();
});

test("the programs list and a program page pass", async ({ page }, info) => {
  await checkPage(page, "/programs", `programs-${info.project.name}`);
  await checkPage(page, "/programs/odonnell", `odonnell-${info.project.name}`);
});

test("the 2026 playoffs crown no one and name no source (ADR 0004, ADR 0009)", async ({ page }) => {
  await page.goto("/scores");
  await expect(page.getByText(/UIL DI · Bi-district/).first()).toBeVisible();
  await page.getByRole("group", { name: "Show games from" }).getByRole("button", { name: "TAPPS" }).click(); // robot-read, so unconfirmed
  await expect(page.getByText(/^Unconfirmed\s*Score may change\.$/).first()).toBeAttached(); // played, unconfirmed: no winner
  await expect(page.locator("body")).not.toContainText(/maxpreps|bracket\./i);
});

test("a program page lists its season, marked unconfirmed, naming no source (ADR 0009, ADR 0010)", async ({ page }) => {
  for (const url of ["/programs/odonnell", "/rankings"]) {
    await page.goto(url);
    await expect(page.locator("body"), url).not.toContainText(/maxpreps|sources|bracket\./i);
  }
  await page.goto("/programs/odonnell");
  const games = page.getByRole("region", { name: "2026 games" });
  await expect(games.getByRole("listitem").first()).toContainText(/\d+-\d+/);
  await expect(games).toContainText("not confirmed here");
});

test("program pages cover every league, link rivals, and 404 when unknown", async ({ page }) => {
  for (const slug of ["boys-ranch", "abilene-christian-school", "harvest-lantana", "texas-wind"]) {
    expect((await page.goto(`/programs/${slug}`))?.status(), slug).toBe(200);
  }
  await page.goto("/programs/boys-ranch");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Boys Ranch");
  const rival = page.getByRole("region", { name: /rivals/ }).getByRole("link").first();
  const name = await rival.evaluate((el) => el.lastChild?.textContent ?? "");
  await rival.click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
  expect((await page.goto("/programs/no-such-school"))?.status()).toBe(404);
});

test("school colors, a logo, a white logo and a colored badge all pass", async ({ page }, info) => {
  // odonnell: logo and colors · boys-ranch: a wide wordmark · amherst: a white mark on a dark tile · new-braunfels-spartans: a badge (no logo from an allowed source)
  for (const slug of ["boys-ranch", "amherst", "new-braunfels-spartans"]) await checkPage(page, `/programs/${slug}`, `${slug}-${info.project.name}`);
  await page.goto("/programs/odonnell");
  const logo = page.getByRole("img", { name: "O'Donnell logo" });
  await expect(logo).toBeVisible();
  expect(await logo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  await expect(page.getByRole("link", { name: /^Logo: / })).toHaveCount(0); // sources stay in the data (ADR 0010)
  await page.goto("/programs/new-braunfels-spartans");
  await expect(page.locator("header img")).toHaveCount(0);
});

test("the site can be added to a phone's home screen", async ({ request }) => {
  const manifest = await (await request.get("/manifest.webmanifest")).json();
  expect(manifest).toMatchObject({ display: "standalone", start_url: "/", theme_color: "#0a2a5e" });
  for (const icon of manifest.icons) {
    const res = await request.get(icon.src);
    expect(res.status(), icon.src).toBe(200);
    expect(res.headers()["content-type"]).toBe("image/png");
  }
});

test("a shared program link previews a card in the school's colors", async ({ page, request }) => {
  await page.goto("/programs/jayton");
  const image = await page.locator('meta[property="og:image"]').getAttribute("content");
  expect(image).toContain("/programs/jayton/opengraph-image");
  const res = await request.get(new URL(image!).pathname + new URL(image!).search);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("image/png");
  mkdirSync(SHOTS, { recursive: true });
  writeFileSync(path.join(SHOTS, "og-jayton.png"), await res.body());
  await page.goto("/");
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", /\/opengraph-image/);
});

test("section pages preview their own card", async ({ page, request }) => {
  test.setTimeout(90_000); // the dev server draws each card on first request
  mkdirSync(SHOTS, { recursive: true });
  for (const [url, card] of [
    ["/playoffs", "/playoffs/opengraph-image"],
    ["/playoffs/tapps", "/playoffs/tapps/opengraph-image"],
    ["/playoffs/season/2025", "/playoffs/season/2025/opengraph-image"],
    ["/playoffs/season/2025/tapps", "/playoffs/season/2025/tapps/opengraph-image"],
    ["/records", "/records/opengraph-image"],
    ["/results", "/results/opengraph-image"],
    ["/results/2025/9", "/results/opengraph-image"],
  ]) {
    await page.goto(url);
    const image = await page.locator('meta[property="og:image"]').getAttribute("content");
    expect(image, url).toContain(card);
    const res = await request.get(new URL(image!).pathname + new URL(image!).search);
    expect(res.status(), url).toBe(200);
    expect(res.headers()["content-type"]).toBe("image/png");
    writeFileSync(path.join(SHOTS, `og${url.replaceAll("/", "-")}.png`), await res.body());
  }
});

test("logo files are served locked down", async ({ request }) => {
  const res = await request.get("/logos/boys-ranch.png");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-security-policy"]).toContain("sandbox");
  expect(res.headers()["content-type"]).toBe("image/png");
});

for (const g of demoGames) {
  test(`game page ${g.id} (${g.state}, ${g.verification}) passes`, async ({ page }, info) => {
    await checkPage(page, `/scores/${g.id}`, `${g.id}-${info.project.name}`);
  });
}

test("only a confirmed final names a winner", async ({ page }) => {
  await page.goto("/scores/sample");
  const row = (id: string) => page.locator(`[data-game="${id}"]`);
  const crowned = (id: string) => row(id).getByText("winner", { exact: true });
  await expect(crowned("g4")).toHaveCount(1);
  for (const id of ["g3", "g5", "g6", "g7"]) await expect(crowned(id)).toHaveCount(0);
  await expect(row("g3")).toContainText("Unconfirmed");
  await expect(row("g7")).toContainText("Disputed");
});

test("a forfeit shows W and L, never a score", async ({ page }) => {
  await page.goto("/scores/sample");
  await page.getByRole("group", { name: "Show games from" }).getByRole("button", { name: "TAPPS" }).click(); // g6 is a TAPPS game
  const row = page.locator('[data-game="g6"]');
  await expect(row).toContainText("forfeit win");
  await expect(row).toContainText("forfeit loss");
});

test("a game ended early shows dashes for the quarters not played", async ({ page }) => {
  await page.goto("/scores/g2");
  await expect(page.getByRole("table").getByText("not played")).toHaveCount(4);
  await page.goto("/scores/g4");
  await expect(page.getByRole("table").getByText("not played")).toHaveCount(0);
});

test("find a team narrows the board", async ({ page }) => {
  await page.goto("/scores/sample", { waitUntil: "networkidle" });
  const search = page.getByRole("searchbox", { name: "Find a team" });
  await search.fill("cedar");
  await expect(page.locator("[data-game]")).toHaveCount(1);
  await search.fill("zzzz");
  await expect(page.getByText("No team matches")).toBeVisible();
});

test("an unknown game is a 404", async ({ page }) => {
  expect((await page.goto("/scores/nope"))?.status()).toBe(404);
});

test("rankings pick a season; a past season shows its final table, overall only", async ({ page }, info) => {
  await checkPage(page, "/rankings/season/2025", `rankings-2025-${info.project.name}`);
  const seasons = page.getByRole("navigation", { name: "Season" });
  await expect(seasons.getByRole("link", { name: "2025" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("navigation", { name: "Rankings by division" })).toHaveCount(0);
  await expect(page.getByText(/^Final: \d+ teams/)).toBeVisible();
  expect(await page.locator("tbody tr").count()).toBeLessThan(262); // UIL only, no other organization
  await expect(page.getByText(/since last week/)).toHaveCount(0);
  await seasons.getByRole("link", { name: "2026" }).click();
  await expect(page).toHaveURL(/\/rankings$/, { timeout: 20_000 });
  await expect(page.getByRole("navigation", { name: "Rankings by division" })).toBeVisible();
});

test("a program page lists each season: record, place and the last playoff round played", async ({ page }) => {
  await page.goto("/programs/gordon");
  const trend = page.getByRole("region", { name: "2026 rank by week" });
  await expect(trend.getByRole("img", { name: /^Rank in its organization from #\d+ in the week ending .+ to #\d+ in the week ending .+; best #\d+\.$/ })).toBeVisible();
  expect(await trend.locator("tbody tr").count()).toBeGreaterThanOrEqual(3);
  const seasons = page.getByRole("region", { name: "Season by season" });
  await expect(seasons.getByRole("listitem")).toHaveCount(6);
  const last = seasons.getByRole("listitem").filter({ has: page.getByRole("link", { name: "2025 rankings" }) });
  await expect(last).toContainText("Playoffs: reached the state final");
  await expect(seasons.getByText(/^\d+-\d+(-\d+)? from 2021 to 2026 · playoffs in \d of 6 seasons$/)).toBeVisible();
  const rivals = page.getByRole("region", { name: "Most played" }).getByRole("listitem");
  expect(await rivals.count()).toBeGreaterThan(0);
  await expect(rivals.first()).toContainText(/\d+ games · last 20\d\d, \d+-\d+/);
  await expect(last).toContainText(/#\d+ of \d+ in UIL/);
  await expect(last.getByRole("link")).toHaveAttribute("href", "/rankings/season/2025");
  await expect(seasons.getByRole("link", { name: "2026 rankings" })).toHaveAttribute("href", "/rankings");
  await seasons.getByText(/^2025 games \(\d+\)$/).click();
  await expect(seasons.getByText(/vs Rankin|at Rankin/)).toBeVisible();
  await expect(seasons.getByText(/^2026 games/)).toHaveCount(0);
});

test("results list every game week by week, both seasons, naming no winner and no source", async ({ page }, info) => {
  await checkPage(page, "/results", `results-${info.project.name}`);
  const weeks = page.getByRole("navigation", { name: "Week" });
  await expect(weeks.locator("[aria-current=page]")).toHaveCount(1);
  await expect(page.getByText(/won|beat|defeated|maxpreps/i)).toHaveCount(0);
  await checkPage(page, "/results/2025/1", `results-2025-1-${info.project.name}`);
  await expect(page.getByText(/^UIL · 2025 season · Week 1 · \d+ games$/)).toBeVisible();
  await page.goto("/results/2025/9");
  expect(await page.getByText(/^Projected: .+ by (\d+|45\+) · (>99|\d+)% win probability$/).count()).toBeGreaterThan(10);
  await expect(page.getByText(/upset/i)).toHaveCount(0);
  // A forfeit (recorded 1-0) shows the word, never the score (ADR 0004).
  await page.goto("/programs/avalon");
  await expect(page.getByText("Forfeit").first()).toBeVisible();
  await expect(page.getByText(/\b(0-1|1-0)\b/)).toHaveCount(0);
  await page.goto("/results/2025/1");
  const first = page.locator("main li").first();
  await expect(first.getByRole("link")).toHaveCount(3); // the two teams, and the game page
  await page.getByRole("navigation", { name: "Season" }).getByRole("link", { name: "2026" }).click();
  await expect(page).toHaveURL(/\/results$/, { timeout: 20_000 });
});

test("matchup lists the last meetings between two teams across seasons", async ({ page }) => {
  await page.goto("/matchup?a=gordon&b=rankin");
  const projection = page.getByRole("region", { name: "Projection" });
  await expect(projection.getByRole("heading", { name: "Last meetings" })).toBeVisible();
  await expect(projection.getByText("Dec 17, 2025")).toBeVisible();
  await expect(projection.getByText("Gordon 69, Rankin 22")).toBeVisible();
  await expect(projection.getByText(/won|beat|defeated/i)).toHaveCount(0);
});

test("records list the most points, the longest winning runs and unbeaten seasons, naming no source", async ({ page }, info) => {
  await checkPage(page, "/records", `records-${info.project.name}`);
  for (const name of ["Most points in a game", "Most points by both teams", "Biggest upsets", "Longest winning runs", "Unbeaten seasons"]) {
    await expect(page.getByRole("region", { name })).toBeVisible();
  }
  const points = page.getByRole("region", { name: "Most points in a game" }).getByRole("listitem");
  await expect(points).toHaveCount(10);
  const figures = await points.locator("span.font-num.text-navy").allTextContents();
  expect(figures.map(Number)).toEqual([...figures.map(Number)].sort((a, b) => b - a));
  await expect(page.getByText(/maxpreps|odds|spread|underdog|line\b/i)).toHaveCount(0);
  const upsets = await page.getByRole("region", { name: "Biggest upsets" }).locator("li span.font-num.text-navy").allTextContents();
  expect(upsets.length).toBe(10);
  for (const u of upsets) expect(u).toMatch(/^(<1|[1-4]\d?)%( win probability before the game)?$/); // the unit after it is read aloud only
});

test("playoffs show every bracket round by round, naming no winner and no source", async ({ page }, info) => {
  await checkPage(page, "/playoffs", `playoffs-${info.project.name}`);
  const tabs = page.getByRole("navigation", { name: "League" });
  await expect(tabs.getByRole("link")).toHaveText(["UIL", "TAPPS", "TAIAO", "TCAF"]);
  for (const name of ["UIL Division I", "UIL Division II"]) await expect(page.getByRole("region", { name, exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "UIL Division I, Bi-district" }).getByRole("listitem")).toHaveCount(16);
  await expect(page.getByText(/won|beat|defeated|maxpreps|odds|spread/i)).toHaveCount(0);
  expect(await page.getByText(/Projected: .+ by (\d+|45\+) · (>99|\d+)% win probability/).count()).toBeGreaterThan(0);

  await checkPage(page, "/playoffs/tapps", `playoffs-tapps-${info.project.name}`);
  await expect(page.getByRole("heading", { level: 2 })).toHaveCount(5);
  // Quarterfinals sit in the order of the semifinals they feed: every semifinal team played in the quarterfinal
  // listed at the same place, two to a semifinal.
  const bracket = page.getByRole("region", { name: "TAPPS Division I", exact: true });
  const semis = await bracket.getByRole("region", { name: /Semifinal$/ }).getByRole("listitem").allTextContents();
  const quarters = await bracket.getByRole("region", { name: /Quarterfinal$/ }).getByRole("listitem").allTextContents();
  expect(semis).toHaveLength(2);
  expect(quarters).toHaveLength(4);

  await checkPage(page, "/playoffs/tcaf", `playoffs-tcaf-${info.project.name}`);
  await expect(page.getByRole("region", { name: "TCAF, Final" }).getByRole("listitem")).toHaveCount(1);
});

test("rankings stand at the end of each week, with records then and moves from the week before", async ({ page }, info) => {
  await page.goto("/rankings");
  await page.getByRole("link", { name: "Rankings at the end of each week" }).click();
  await expect(page).toHaveURL(/\/rankings\/week\/\d+$/);
  const weeks = page.getByRole("navigation", { name: "Week" });
  await expect(weeks.locator("[aria-current=page]")).toHaveCount(1);
  const first = await weeks.getByRole("link").first().textContent();
  await checkPage(page, `/rankings/week/${first}`, `rankings-week-${info.project.name}`);
  await expect(page.getByText(new RegExp(`^\\d{4} season · UIL · after week ${first}$`))).toBeVisible();
  const early = await page.locator("tbody tr").count();
  // Early in the season every record is short: no team has more than the weeks played so far allow.
  const records = await page.locator("tbody tr td:nth-child(3)").allTextContents();
  for (const r of records) expect(r.split("-").map(Number).reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(Number(first) + 1);
  await page.goto("/rankings");
  await page.getByRole("link", { name: "Rankings at the end of each week" }).click();
  expect(await page.locator("tbody tr").count()).toBeGreaterThanOrEqual(early);
  await expect(page.locator("tbody").getByText(/^▲\d+$/).first()).toBeVisible();
});

test("past playoff seasons list their brackets round by round, with no projections, winners or source", async ({ page }, info) => {
  await checkPage(page, "/playoffs/season/2025", `playoffs-2025-${info.project.name}`);
  const seasons = page.getByRole("navigation", { name: "Season" });
  await expect(seasons.getByRole("link")).toHaveText(["2026", "2025", "2024", "2023", "2022", "2021"]);
  await expect(seasons.getByRole("link", { name: "2025" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("navigation", { name: "League" }).getByRole("link")).toHaveText(["UIL", "TAPPS", "TAIAO", "TCAF"]);
  const division = page.getByRole("region", { name: "UIL Division I", exact: true });
  await expect(division.getByRole("region", { name: "UIL Division I, State final" }).getByRole("listitem")).toHaveCount(1);
  await expect(page.getByText(/Projected:|title chances/i)).toHaveCount(0);
  await expect(page.locator("main").getByText(/won|beat|defeated|champion|maxpreps|odds|spread/i)).toHaveCount(0); // the site nav has "Championships"

  await checkPage(page, "/playoffs/season/2025/tapps", `playoffs-2025-tapps-${info.project.name}`);
  await expect(page.getByRole("navigation", { name: "League" }).getByRole("link", { name: "TAPPS" })).toHaveAttribute("aria-current", "page");
  await expect(page.locator("main").getByRole("listitem").first()).toBeVisible();

  // Seasons keep the league you are on, and the latest season's own URLs are unchanged.
  await seasons.getByRole("link", { name: "2026" }).click();
  await expect(page).toHaveURL(/\/playoffs\/tapps$/);
  await seasons.getByRole("link", { name: "2021" }).click();
  await expect(page).toHaveURL(/\/playoffs\/season\/2021\/tapps$/);
  expect((await page.goto("/playoffs/season/2026"))?.status()).toBe(404);
  expect((await page.goto("/playoffs/season/1999"))?.status()).toBe(404);
});

test("search: a labelled box that passes axe, and (on a production build) finds programs and games", async ({ page }, info) => {
  await checkPage(page, "/search", `search-${info.project.name}`);
  const box = page.getByRole("searchbox", { name: "Search programs and games" });
  await expect(box).toBeVisible();
  // The Pagefind index is written by `npm run build` (CI's production build); the dev server has none.
  test.skip(!process.env.CI, "the search index exists only after a production build");
  await box.fill("Jayton");
  await expect(page.locator('main a[href="/programs/jayton"]')).toBeVisible();
  await expect(page.getByRole("link", { name: /^\d{4} week \d+ results/ }).first()).toBeVisible();
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);
  await page.goto("/search?q=jayton");
  await expect(page.getByRole("status")).toHaveText(/pages? match/);
});

test("search engines: only the public address is indexed, from robots.txt and a sitemap; logos keep their lockdown", async ({ page, request }) => {
  const PUBLIC = { host: "txsixmanfootball.com" };
  // public/sw.js is written by the production build (scripts/build-sw.mjs); the dev server has none.
  for (const url of ["/", "/programs/jayton", ...(process.env.CI ? ["/sw.js"] : [])]) {
    // Any other address (vercel.app, previews, this test server) says noindex, so pages never show up twice.
    const here = await request.get(url);
    expect(here.status(), url).toBe(200);
    expect(here.headers()["x-robots-tag"], url).toBe("noindex, nofollow");
    expect((await request.get(url, { headers: PUBLIC })).headers()["x-robots-tag"], url).toBeUndefined();
  }
  // Visitors see the site's name, never the codename (the owner, Nov 11, 2026).
  await page.goto("/programs/jayton");
  await expect(page).toHaveTitle(/^Jayton \| TX Six-Man Football$/);
  expect((await (await request.get("/manifest.webmanifest")).json()).name).toBe("TX Six-Man Football");
  await page.goto("/");
  await expect(page).toHaveTitle("TX Six-Man Football");
  await expect(page.locator("header").getByRole("link", { name: "TX Six-Man Football" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("80x40");
  await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
  for (const url of ["/rankings/sample", "/scores/sample", "/search", "/~offline"]) {
    await page.goto(url);
    await expect(page.locator('meta[name="robots"]'), url).toHaveAttribute("content", /noindex/);
  }

  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toContain("Allow: /");
  expect(robots).not.toContain("Disallow");
  expect(robots).toContain("Sitemap: https://txsixmanfootball.com/sitemap.xml");
  const sitemap = await (await request.get("/sitemap.xml")).text();
  const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  expect(urls.every((u) => u.startsWith("https://txsixmanfootball.com"))).toBe(true);
  for (const path of ["", "/programs/jayton", "/rankings/how", "/rankings/division-1", "/rankings/week/4", "/results/2025", "/standings/tapps", "/championships"]) {
    expect(urls, path).toContain(`https://txsixmanfootball.com${path}`);
  }
  expect(urls.some((u) => /\/results\/2026\/\d+$/.test(u)), "a results week").toBe(true);
  expect(urls.some((u) => /sample|search|offline/.test(u)), "noindex pages stay out").toBe(false);
  expect(new Set(urls).size, "no address twice").toBe(urls.length);
  if (process.env.CI) expect((await request.get("/sw.js")).headers()["cache-control"]).toContain("no-cache");
  const logo = await request.get("/logos/abbott.png");
  expect(logo.headers()["content-security-policy"]).toBe("default-src 'none'; style-src 'unsafe-inline'; sandbox");
});

test("offline: the offline page passes axe on this screen size", async ({ page }, info) => {
  await checkPage(page, "/~offline", `offline-${info.project.name}`);
});

test("PWA: installable, and a visited page opens offline while an unvisited one says so", async ({ page, context }) => {
  // The service worker registers only in a production build (app/offline-notice.tsx).
  test.skip(!process.env.CI, "the service worker runs only in a production build");
  const manifest = await (await page.request.get("/manifest.webmanifest")).json();
  expect(manifest).toMatchObject({ display: "standalone", start_url: "/" });
  await page.goto("/championships");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); // now through the service worker, which keeps a copy
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/championships/i);
  await expect(page.getByRole("status").filter({ hasText: "You are offline" })).toBeVisible();
  // A page never visited, opened in a new tab: the worker answers with the offline page.
  const fresh = await context.newPage();
  await fresh.goto("/records");
  await expect(fresh.getByRole("heading", { level: 1 })).toHaveText("Offline");
  await context.setOffline(false);
});

test("a program page charts its rating by week (Observable Plot), with a text alternative and no betting words", async ({ page }, info) => {
  await checkPage(page, "/programs/jayton", `rating-chart-${info.project.name}`);
  const section = page.getByRole("region", { name: /rating by week$/ });
  await expect(section.getByRole("img", { name: /^Rating from [+−-]?\d/ })).toBeVisible();
  await expect(section.locator("figcaption")).toHaveText(/Zero is an average team\.$/);
  expect(await section.locator("table tbody tr").count()).toBeGreaterThanOrEqual(3);
  await expect(section.getByText(/odds|spread|line|bet/i)).toHaveCount(0);
});
