import { defineConfig } from "@playwright/test";

// CI tests the production build, which is what Vercel serves. Locally the dev server is used, one test at a time:
// `next dev` races when several pages with generateStaticParams compile at once ("Failed to generate static paths").
const ci = Boolean(process.env.CI);
// E2E_PORT lets a second checkout (an agent's worktree) test its own code without taking :3011 from the main one.
const port = process.env.E2E_PORT ?? "3011";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  workers: ci ? undefined : 1,
  reporter: [["list"]],
  outputDir: "./e2e/.results",
  // A missing screenshot baseline fails in CI rather than being written there and lost (e2e/screenshots.spec.ts).
  updateSnapshots: ci ? "none" : "missing",
  use: { baseURL: `http://localhost:${port}` },
  webServer: {
    // E2E_BUILT: CI's web-build job already built the site (ci.yml), so the page-test shards only serve it.
    command: ci
      ? process.env.E2E_BUILT
        ? "npm run start"
        : "npm run build && npm run start"
      : process.env.E2E_PORT
        ? `npx next dev --webpack -p ${port}`
        : "npm run dev",
    url: `http://localhost:${port}`,
    reuseExistingServer: !ci,
    timeout: 600_000, // the production build renders ~800 static pages before the server starts
  },
  projects: [
    { name: "phone", use: { browserName: "chromium", viewport: { width: 375, height: 812 }, deviceScaleFactor: 2 } },
    { name: "desktop", use: { browserName: "chromium", viewport: { width: 1280, height: 800 } } },
  ],
});
