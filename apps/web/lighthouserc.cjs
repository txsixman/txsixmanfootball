// Lighthouse CI (Apache-2.0): CI's `lighthouse` jobs run it against the production build web-build made (ci.yml), with
// Lighthouse's default mobile settings (a mid-range phone on a slow 4G connection). Each page loads three times and
// each budget checks the median of its own number over the three. Reports go to the job's artifacts and the run
// summary, never to a public server.
//
// Why "median" and not "median-run": median-run picks ONE run (by first paint and time to interactive) and checks every
// number from that run, so one run's outlier fails the check when that run is the one picked. PR 7 (Nov 13, 2026)
// failed that way: /rankings largest paint 3305, 1059 and 1059 ms, the 3305 run picked. The page was not slow: in
// all three runs its largest element (the H1) drew about 150 ms after the response; the 3305 is Lighthouse's
// simulated slow-phone estimate, which landed near time-to-interactive in 4 of 138 runs (/rankings and /results, CI
// runs Nov 12 to 13). The median of each number drops one such run and still fails a page slow in two of three.
//
// Budgets, set Nov 16, 2026 (ADR 0080) from CI's own runs of nine kinds of page (home, scores, playoffs, this round, a
// bracket, a game, a program, rankings, results), median of 3, each budget above the worst page with headroom for a shared
// runner's noise, so a real regression fails and noise does not. Worst page after the phone-speed pass (run 43926555439):
// performance 98 (rankings), largest paint 1061 ms (rankings), blocking time 162 ms (rankings; it moved 53 to 112 ms on
// the same page between two runs), layout shift 0.000, weight 640 KB (/scores), scripts 213 KB (a bracket), HTML 57 KB
// sent (rankings). Before it (run 43923270389) the worst were 97, 1062 ms, 192 ms, 0.029, 710 KB, 203 KB and 57 KB.
// Until Nov 16 the budgets were from the first run (Nov 11: 85, 930 ms, 599 ms, 0.034, 917 KB on four pages) and left
// room for most of what the pass removed: 120 KB of background link loading on every page, and blocking time.
// Tightened Nov 17, 2026 (ADR 0100) after the second pass (a script the pages no longer load, the scores board's page data cut by
// half, no prefetch down a scrolled list), from the pass's own CI run (26043187956, PR 186), worst page each: weight 616 KB
// (/results), scripts 217 KB (a program page), HTML 60 KB sent (rankings); the same pages on main just before it: 677, 236 and 60.
// Weight is the one that holds the line on link prefetching: 700 KB fails if the section links go back to loading every
// page they point at (about 85 KB), which the old 1200 KB would not have noticed.
module.exports = {
  ci: {
    collect: {
      startServerCommand: "npm run start",
      startServerReadyPattern: "Ready",
      // CI splits the pages across jobs with LHCI_PAGES (ci.yml); without it, all of them: one of each kind of page a
      // fan opens (home, scores, playoffs this round, a bracket, a game, a program, rankings, results).
      url: (process.env.LHCI_PAGES ?? "/,/rankings,/results,/programs/jayton,/scores,/playoffs,/playoffs/this-round,/playoffs/bracket/uil-division-i,/scores/2026-11-06-earth-springlake-at-whitharral,/welcome,/search")
        .split(",")
        .map((page) => `http://localhost:3011${page}`),
      numberOfRuns: 3,
      settings: {
        // Playwright's container runs as root, where Chrome's sandbox cannot start.
        chromeFlags: "--no-sandbox --headless=new",
      },
    },
    assert: {
      assertions: {
        "categories:performance": ["error", { minScore: 0.9, aggregationMethod: "median" }],
        "categories:accessibility": ["error", { minScore: 0.95, aggregationMethod: "median" }],
        "categories:best-practices": ["error", { minScore: 0.95, aggregationMethod: "median" }],
        "largest-contentful-paint": ["error", { maxNumericValue: 1600, aggregationMethod: "median" }],
        "total-blocking-time": ["error", { maxNumericValue: 350, aggregationMethod: "median" }],
        "cumulative-layout-shift": ["error", { maxNumericValue: 0.03, aggregationMethod: "median" }],
        "total-byte-weight": ["error", { maxNumericValue: 660 * 1024, aggregationMethod: "median" }],
        // Bytes sent (compressed), by kind: the scripts a page loads, and its HTML (the largest, /rankings, is 60 KB).
        "resource-summary:script:size": ["error", { maxNumericValue: 240 * 1024, aggregationMethod: "median" }],
        "resource-summary:document:size": ["error", { maxNumericValue: 70 * 1024, aggregationMethod: "median" }],
      },
    },
    upload: { target: "filesystem", outputDir: "./e2e/.lighthouse" },
  },
};
