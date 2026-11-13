// Waits for this run's web-build job (ci.yml), so the page-test shards and Lighthouse can set up (container, npm ci)
// while the site builds instead of after. Writes site=true when the build uploaded its artifact, site=false when it
// passed without one (a docs-only change), and fails if the build failed, was cancelled or had not finished after 25
// minutes (a queued build on a busy free-plan runner pool counts: page jobs failed that way on Nov 13, 2026).
// One API call every 10 s (the token's limit is 1,000 calls an hour per repository).
import { appendFileSync } from "node:fs";

const env = process.env;
const run = `${env.GITHUB_API_URL}/repos/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`;

async function get(path) {
  const res = await fetch(run + path, {
    headers: { authorization: `Bearer ${env.GITHUB_TOKEN}`, accept: "application/vnd.github+json" },
  });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

const deadline = Date.now() + 25 * 60_000;
let errors = 0;
while (Date.now() < deadline) {
  try {
    const { jobs } = await get(`/attempts/${env.GITHUB_RUN_ATTEMPT}/jobs?per_page=100`);
    const build = jobs.find((job) => job.name === "web-build");
    if (build?.status === "completed") {
      if (build.conclusion !== "success") {
        console.error(`web-build ended ${build.conclusion}; nothing to test.`);
        process.exit(1);
      }
      const { total_count } = await get("/artifacts?name=web-build");
      const site = total_count > 0;
      appendFileSync(env.GITHUB_OUTPUT, `site=${site}\n`);
      console.log(site ? "The build is ready." : "Docs only: no build, nothing to test.");
      process.exit(0);
    }
  } catch (error) {
    // A failed call is retried on the next round; three in a row fail the job loudly.
    console.error(String(error));
    if (++errors >= 3) process.exit(1);
    await new Promise((resolve) => setTimeout(resolve, 10_000));
    continue;
  }
  errors = 0;
  await new Promise((resolve) => setTimeout(resolve, 10_000));
}
console.error("web-build did not finish within 25 minutes.");
process.exit(1);
