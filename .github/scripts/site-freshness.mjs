// Is production serving the newest data? Compares the commit the live site was built from (its /build.json marker,
// apps/web/app/build.json/route.ts) with the newest commit on main that changed data/ (Vercel's Ignored Build Step
// skips commits that change neither data/ nor the site, so only those must reach production). Through GitHub's API with
// the workflow's own read-only token; nothing else.
//
//   node .github/scripts/site-freshness.mjs                 the scheduled check: fails when production has lacked a data
//                                                           commit for more than 30 minutes (site-freshness.yml)
//   node .github/scripts/site-freshness.mjs --expect <sha>  after Results watch pushed <sha>: waits up to --wait seconds
//                                                           (default 300) and reports "deployed" or "not yet"; never fails
// Env: GITHUB_TOKEN, GITHUB_REPOSITORY (owner/name), SITE (default https://txsixmanfootball.com).

export const LIMIT_MINUTES = 30;

/**
 * The verdict from what was looked up. `status` is GitHub's compare of production's commit (base) with the data commit
 * (head): "identical" or "behind" means production has it. `behindSince` is when the oldest data commit production lacks
 * was made. Without a marker (or a commit GitHub does not know) production counts as lacking every data commit since
 * `behindSince`.
 * @returns {{ state: "fresh" | "deploying" | "stale", gapMinutes: number, line: string }}
 */
export function judge({ dataSha, prodSha, status, behindSince, now, limit = LIMIT_MINUTES }) {
  const short = (s) => (s ? s.slice(0, 7) : "none");
  if (prodSha && (status === "identical" || status === "behind")) {
    return { state: "fresh", gapMinutes: 0, line: `Production (${short(prodSha)}) has the newest data commit (${short(dataSha)}).` };
  }
  const since = Date.parse(behindSince);
  if (!Number.isFinite(since)) throw new Error(`behindSince is not a date: ${behindSince}`);
  const gapMinutes = Math.max(0, Math.floor((now - since) / 60_000));
  const what = !prodSha ? "Production shows no build marker" : status ? `Production (${short(prodSha)}) lacks data commit ${short(dataSha)}` : `Production's commit ${short(prodSha)} is not on GitHub`;
  const state = gapMinutes > limit ? "stale" : "deploying";
  const verdict = state === "stale" ? `more than the ${limit} allowed` : `within the ${limit} allowed for a deploy`;
  return { state, gapMinutes, line: `${what}: behind for ${gapMinutes} min, ${verdict}.` };
}

/** After a push: has production got `expected`? */
export const hasCommit = (prodSha, status) => Boolean(prodSha) && (status === "identical" || status === "behind");

/** The marker's commit, or null when the page is missing or not a marker. */
export function readMarker(body) {
  const sha = body && typeof body === "object" ? body.sha : null;
  return typeof sha === "string" && /^[0-9a-f]{40}$/.test(sha) ? sha : null;
}

async function main(argv) {
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  const site = (process.env.SITE || "https://txsixmanfootball.com").replace(/\/$/, "");
  if (!repo || !token) throw new Error("GITHUB_REPOSITORY and GITHUB_TOKEN are needed");
  const arg = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
  const expect = arg("--expect");
  const waitSeconds = Number(arg("--wait") ?? 300);

  const gh = async (path, { allow404 = false } = {}) => {
    const res = await fetch(`https://api.github.com/repos/${repo}${path}`, {
      headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" },
    });
    if (allow404 && (res.status === 404 || res.status === 422)) return null;
    if (!res.ok) throw new Error(`GitHub ${path.split("?")[0]}: ${res.status}`);
    return res.json();
  };
  const marker = async () => {
    const res = await fetch(`${site}/build.json?check=${Date.now()}`, { cache: "no-store", redirect: "follow" }).catch(() => null);
    return res?.ok ? readMarker(await res.json().catch(() => null)) : null;
  };
  const compare = async (base, head) => (base ? ((await gh(`/compare/${base}...${head}`, { allow404: true }))?.status ?? null) : null);
  const summary = (text) => console.log(text);

  if (expect) {
    const deadline = Date.now() + waitSeconds * 1000;
    for (;;) {
      const prod = await marker();
      if (hasCommit(prod, await compare(prod, expect))) {
        summary(`Deployed: production serves ${prod.slice(0, 7)}, which has ${expect.slice(0, 7)}.`);
        return 0;
      }
      if (Date.now() >= deadline) {
        summary(`Not yet: after ${waitSeconds} s production serves ${prod ? prod.slice(0, 7) : "no build marker"}, without ${expect.slice(0, 7)}. The Site freshness check fails if it is still missing after ${LIMIT_MINUTES} minutes.`);
        return 0;
      }
      await new Promise((r) => setTimeout(r, 30_000));
    }
  }

  const [newest] = await gh("/commits?sha=main&path=data&per_page=1");
  if (!newest) throw new Error("no commit on main touches data/");
  const dataSha = newest.sha;
  const prodSha = await marker();
  const status = await compare(prodSha, dataSha);
  let behindSince = newest.commit.committer.date;
  if (prodSha && status && !hasCommit(prodSha, status)) {
    // The oldest data commit production lacks: the data commits made after production's own commit.
    const prodCommit = await gh(`/commits/${prodSha}`);
    const after = await gh(`/commits?sha=main&path=data&per_page=100&since=${encodeURIComponent(prodCommit.commit.committer.date)}`);
    const missing = after.filter((c) => c.sha !== prodSha).map((c) => c.commit.committer.date).sort();
    if (missing.length) behindSince = missing[0];
  }
  const verdict = judge({ dataSha, prodSha, status, behindSince, now: Date.now() });
  summary(`Site freshness: ${verdict.state}. ${verdict.line}`);
  return verdict.state === "stale" ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(`Site freshness could not check: ${error.message}`);
      process.exit(1);
    },
  );
}
