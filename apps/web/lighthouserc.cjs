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
// Budgets: the first CI run (Nov 11, 2026, median of 3) measured, worst of the four pages: performance 85 (home 98),
// accessibility 100, best practices 100, largest paint 930 ms, blocking time 599 ms, layout shift 0.034, weight 917 KB.
// Each budget sits above that with headroom for a shared runner's noise, so a real regression fails and noise does not.
module.exports = {
  ci: {
    collect: {
      startServerCommand: "npm run start",
      startServerReadyPattern: "Ready",
      // CI splits the four pages across two jobs with LHCI_PAGES (ci.yml); without it, all four.
      url: (process.env.LHCI_PAGES ?? "/,/rankings,/results,/programs/jayton")
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
        "categories:performance": ["error", { minScore: 0.75, aggregationMethod: "median" }],
        "categories:accessibility": ["error", { minScore: 0.95, aggregationMethod: "median" }],
        "categories:best-practices": ["error", { minScore: 0.95, aggregationMethod: "median" }],
        "largest-contentful-paint": ["error", { maxNumericValue: 2500, aggregationMethod: "median" }],
        "total-blocking-time": ["error", { maxNumericValue: 900, aggregationMethod: "median" }],
        "cumulative-layout-shift": ["error", { maxNumericValue: 0.1, aggregationMethod: "median" }],
        "total-byte-weight": ["error", { maxNumericValue: 1200 * 1024, aggregationMethod: "median" }],
      },
    },
    upload: { target: "filesystem", outputDir: "./e2e/.lighthouse" },
  },
};
