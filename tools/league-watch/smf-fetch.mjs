// The polite fetcher for SixManFootball.com score pages (ADR 0020). Every rule of the ADR that is about fetching lives
// here, so the score reader cannot get around it:
// - honest identity: our own user agent, never a browser's or Claude's;
// - robots.txt read at the start of every run, and no read at all without it (anything but a 200);
// - a path is requested only if robots.txt allows it for our agent and for "*", and it is a score page (`allowed`);
// - one request at a time, `delayMs` apart; a redirect is never followed;
// - a 429 or 5xx waits (Retry-After when given, at most two minutes) and tries again twice; a page that still fails
//   is given up, and `maxFailures` given-up pages in a run end the run.

import { robotsAllows } from "./tapps.mjs";

export const ORIGIN = "https://sixmanfootball.com";
export const USER_AGENT = "TXSixManFootballBot/1.0 (+https://txsixmanfootball.com/about; contact@txsixmanfootball.com)";
const AGENT_TOKEN = "TXSixManFootballBot";

/** Seconds a Retry-After header asks for (a number of seconds or a date), capped; undefined when absent or unreadable. */
export function retryAfterMs(header, now = Date.now(), capMs = 120_000) {
  if (!header) return undefined;
  const seconds = Number(header);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - now;
  return Number.isFinite(ms) ? Math.min(Math.max(ms, 0), capMs) : undefined;
}

/**
 * A reader for one run. `allowed(path)` says which paths are score pages (the reader's own list, ADR 0020 rule 3);
 * `fetchImpl` and `sleep` are injectable for tests. `start()` must be called first: it reads robots.txt.
 */
export function createFetcher({ allowed, fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), delayMs = 4000, waits = [10_000, 30_000], maxFailures = 3 }) {
  let robots = null;
  let last = 0;
  let failures = 0;
  const headers = { "user-agent": USER_AGENT };

  async function polite() {
    const wait = last + delayMs - Date.now();
    if (last && wait > 0) await sleep(wait);
    last = Date.now();
  }

  async function start() {
    await polite();
    const res = await fetchImpl(`${ORIGIN}/robots.txt`, { headers, redirect: "manual", signal: AbortSignal.timeout(30_000) });
    if (res.status !== 200) throw new Error(`robots.txt answered ${res.status}: not reading without it (ADR 0020)`);
    robots = await res.text();
  }

  /** A page's HTML, or null for a 404 or a redirect (logged, never followed). Throws on a refused path or a run that failed too often. */
  async function get(pagePath) {
    if (robots === null) throw new Error("start() reads robots.txt before any page");
    if (!pagePath.startsWith("/") || pagePath.startsWith("//")) throw new Error(`not a path on the site: ${pagePath}`);
    if (!allowed(pagePath)) throw new Error(`refusing a path that is not a score page (ADR 0020): ${pagePath}`);
    if (!robotsAllows(robots, pagePath, AGENT_TOKEN)) throw new Error(`robots.txt disallows ${pagePath}: stopping (ADR 0020)`);
    for (let attempt = 0; ; attempt++) {
      await polite();
      const res = await fetchImpl(`${ORIGIN}${pagePath}`, { headers, redirect: "manual", signal: AbortSignal.timeout(30_000) });
      if (res.status === 200) return res.text();
      if (res.status === 404) return null;
      if (res.status >= 300 && res.status < 400) {
        console.warn(`skipping ${pagePath}: redirected to ${res.headers.get("location")}`);
        return null;
      }
      // A refusal is the site saying no: the run stops rather than try other pages.
      if (res.status === 401 || res.status === 403) throw new Error(`${pagePath}: HTTP ${res.status}, the site refused us: stopping (ADR 0020)`);
      if ((res.status === 429 || res.status >= 500) && attempt < waits.length) {
        const wait = retryAfterMs(res.headers.get("retry-after")) ?? waits[attempt];
        console.warn(`${pagePath}: HTTP ${res.status}, waiting ${Math.round(wait / 1000)} s`);
        await sleep(wait);
        continue;
      }
      failures += 1;
      if (failures >= maxFailures) throw new Error(`${failures} pages failed this run (last: ${pagePath}, HTTP ${res.status}): stopping`);
      console.warn(`giving up on ${pagePath}: HTTP ${res.status}`);
      return null;
    }
  }

  return { start, get };
}
