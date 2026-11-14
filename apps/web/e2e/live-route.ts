import type { Page } from "@playwright/test";
import { SUPABASE_URL } from "../lib/supabase-public";

/** The request the scoreboard and game pages make for live scores (ADR 0021). */
export const LIVE_SCORES_URL = `${SUPABASE_URL}/rest/v1/rpc/live_scores`;

/** The request the Tonight and /scores boards make for the time of the last read (ADR 0038). */
export const READ_AT_URL = `${SUPABASE_URL}/rest/v1/rpc/results_read_at`;

/** Answers `url` with `body` (JSON text) and the CORS headers a browser needs for the preflight. */
export const answer = (page: Page, url: string, body: string) =>
  page.route(url, (route) =>
    route.fulfill({ status: route.request().method() === "OPTIONS" ? 204 : 200, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "POST, OPTIONS" }, body }),
  );

/** Answers them with "no game under way" and "no read recorded", so a test never reaches the real project and no failed
 * request lands in the console. Call it first in any test that opens /scores, Tonight or a game page and checks for console errors. */
const routeNoLiveScores = async (page: Page) => {
  await answer(page, LIVE_SCORES_URL, "[]");
  await answer(page, READ_AT_URL, "null");
};

/** For a spec that opens /scores or a game page: no live-score request reaches the network (a failed one would land in the
 * console, and the real project must never be hit by a test). Pass `block` false where the spec needs the service worker. */
export function noLiveScores(test: { use: (o: { serviceWorkers: "block" }) => void; beforeEach: (fn: (a: { page: Page }) => Promise<unknown>) => void }, block = true) {
  if (block) test.use({ serviceWorkers: "block" });
  test.beforeEach(({ page }) => routeNoLiveScores(page));
}
