// Which commit the site was built from, and when: the marker the Site freshness check (.github/workflows/site-freshness.yml)
// compares with the newest data commit on main, so a skipped or failed deploy is noticed. Static, made once at build time.
// Nothing sensitive: the commit is public in this repo; no data, no environment beyond Vercel's own commit id.
export const dynamic = "force-static";

export function GET() {
  return Response.json({ sha: process.env.VERCEL_GIT_COMMIT_SHA || null, builtAt: new Date().toISOString() });
}
