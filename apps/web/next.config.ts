import { readdirSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

const headers = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

// The newest season with a ratings table (lib/ratings.ts ratingSeasons, which reads the same folder at build time).
// shortcut: 2026 when the folder cannot be read; upgrade: lib gains a shared CURRENT_SEASON this file can import.
const LATEST_SEASON = (() => {
  try {
    const years = readdirSync(path.join(process.cwd(), "../../data/ratings")).flatMap((f) => (/^\d{4}\.json$/.test(f) ? [Number(f.slice(0, 4))] : []));
    return Math.max(2026, ...years);
  } catch {
    return 2026;
  }
})();

const config: NextConfig = {
  poweredByHeader: false,
  // Ratings became Rankings and Champions became State Championships (Nov 11, 2026); old links keep working.
  async redirects() {
    return [
      { source: "/ratings", destination: "/rankings", permanent: true },
      { source: "/ratings/:path*", destination: "/rankings/:path*", permanent: true },
      { source: "/champions", destination: "/championships", permanent: true },
      // The "Private" standings tab held three organizations; each stands alone now (ADR 0012).
      { source: "/standings/private", destination: "/standings/tapps", permanent: true },
      // The latest season lives at the bare address (/results, /rankings), so a link carrying its year lands there. It
      // follows the newest data/ratings/<year>.json; organizations are the ones whose address ends in their slug (ORGS
      // in lib/orgs.ts, minus UIL, the default). A week address (/results/2026/9) is its own page and is not matched.
      ...(["results", "rankings/season"] as const).flatMap((base) => [
        { source: `/${base}/${LATEST_SEASON}`, destination: `/${base.split("/")[0]}`, permanent: false },
        { source: `/${base}/${LATEST_SEASON}/:org(tapps|taiao|tcaf|independent)`, destination: `/${base.split("/")[0]}/:org`, permanent: false },
      ]),
    ];
  },
  async headers() {
    return [
      { source: "/(.*)", headers },
      // Search engines index the public address only (lib/site.ts); the vercel.app address, previews and a local
      // server say noindex, so the same pages never show up twice.
      { source: "/(.*)", missing: [{ type: "host", value: "txsixmanfootball.com" }], headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] },
      // The service worker is checked for a new version on every visit, so a deploy reaches phones at once.
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache" }] },
      // School logos come from other sites (ADR 0006). Opened directly, a file can run nothing and load nothing.
      {
        source: "/logos/:file*",
        headers: [
          { key: "Content-Security-Policy", value: "default-src 'none'; style-src 'unsafe-inline'; sandbox" },
          { key: "Cache-Control", value: "public, max-age=86400" },
        ],
      },
    ];
  },
};

export default config;
