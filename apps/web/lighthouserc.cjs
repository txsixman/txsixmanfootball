// Lighthouse CI (Apache-2.0): CI's `lighthouse` jobs run it against the production build web-build made (ci.yml), with
// Lighthouse's default mobile settings (a mid-range phone on a slow 4G connection). Each page loads three times and
// the median run counts. Reports go to the job's artifacts and the run summary, never to a public server.
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
        "categories:performance": ["error", { minScore: 0.75, aggregationMethod: "median-run" }],
        "categories:accessibility": ["error", { minScore: 0.95, aggregationMethod: "median-run" }],
        "categories:best-practices": ["error", { minScore: 0.95, aggregationMethod: "median-run" }],
        "largest-contentful-paint": ["error", { maxNumericValue: 2500, aggregationMethod: "median-run" }],
        "total-blocking-time": ["error", { maxNumericValue: 900, aggregationMethod: "median-run" }],
        "cumulative-layout-shift": ["error", { maxNumericValue: 0.1, aggregationMethod: "median-run" }],
        "total-byte-weight": ["error", { maxNumericValue: 1200 * 1024, aggregationMethod: "median-run" }],
      },
    },
    upload: { target: "filesystem", outputDir: "./e2e/.lighthouse" },
  },
};
