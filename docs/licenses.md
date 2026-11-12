# Licenses of the tools added to the build

Open-source tools the project runs, with their licenses. Each was checked on npm or PyPI when added; add a row with
every new tool. The site's own runtime dependencies (Next.js, React, Tailwind, lucide-react, Fontsource) are MIT,
ISC or OFL (the fonts) and are listed in `apps/web/package.json`.

| Tool | Version | License | What it does here | Runs where |
|---|---|---|---|---|
| Lighthouse CI (`@lhci/cli`) | 0.16.0 | Apache-2.0 | Speed and accessibility budgets on mobile settings | CI only (`npx`, pinned) |
| Zod (`zod`) | 4.6.7 | MIT | Checks every seed and robot-read row where it is loaded (`apps/web/lib/data-schemas.ts`) | Site build, CI, robot runs |
| Pagefind (`pagefind`) | 1.6.0 | MIT | Static search over program pages and results weeks, indexed after `next build` | Site build (CI, Vercel); `/search` |
| Serwist (`serwist`) | 9.5.13 | MIT | Service worker: offline for visited pages, installable app | Browsers (`public/sw.js`) |
| esbuild (`esbuild`) | 0.28.2 | MIT | Bundles the service worker after `next build` (`scripts/build-sw.mjs`) | Site build |
| paths-filter (`dorny/paths-filter`) | v4 | MIT | Tells CI a docs-only change (`docs/**`, `*.md`) so the site's jobs skip | CI only (GitHub Action) |
| knip (`knip`) | 6.45.1 | ISC | Unused files, exports and dependencies in `apps/web` (`knip.json`) | CI only (`npx`, pinned) |
| Ruff (`ruff`) | 0.17.4 | MIT | Python lint and format check (`ruff.toml`) | CI only (`uvx`, pinned) |
| Vercel Web Analytics (`@vercel/analytics`) | 2.0.1 | MIT | Cookieless page views; no personal data, no banner needed | Browsers, on Vercel only |
| Vercel Speed Insights (`@vercel/speed-insights`) | 2.0.0 | Apache-2.0 | Real visitors' load times (Core Web Vitals) | Browsers, on Vercel only |
| shadcn/ui (copied into `apps/web/components/ui`) | 2026-11 copy | MIT | Button, Input and Label on the site's colors (`globals.css` maps its tokens); used by search and Follow | Browsers |
| Radix UI (`@radix-ui/react-slot`, `@radix-ui/react-label`) | 1.5.0, 2.1.17 | MIT | The accessible primitives under shadcn/ui | Browsers |
| class-variance-authority, clsx, tailwind-merge | 0.7.1, 2.1.1, 3.7.0 | Apache-2.0, MIT, MIT | shadcn/ui's class helpers (`lib/utils.ts`) | Browsers |
| Observable Plot (`@observablehq/plot`) | 0.6.17 | ISC | A program's rating by week (`app/programs/rating-chart.tsx`), drawn at build time | Site build (no chart code shipped) |
| linkedom (`linkedom`) | 0.18.14 | ISC | The DOM Plot draws into on the server | Site build |
| Ladle (`@ladle/react`) | 5.1.1 | MIT | Stories of the scores board and crests in every state, invented schools only (`apps/web/stories`) | Local and CI build only; never deployed |
| Supabase SSR (`@supabase/ssr`) | 0.12.7 | MIT | Cookie sessions for sign-in on the server (`apps/web/lib/auth`); the admin console and later fan accounts | Server only (Vercel functions); no browser client |
| Supabase JS (`@supabase/supabase-js`) | 2.119.0 | MIT | Auth and the one `audit_log` insert, always as the signed-in person (`apps/web/lib/auth`, `lib/admin/audit.ts`); brings its own MIT parts (auth-js, postgrest-js, realtime-js, storage-js, functions-js) | Server only |
| Dependabot | GitHub service | n/a | Weekly update PRs for npm, uv and Actions (`.github/dependabot.yml`) | GitHub |
| web-push (`web-push`) | 4.0.0 | MPL-2.0 | Sends the score alerts (`tools/push/send-finals.mjs`). MPL is file-level copyleft: fine unmodified; any change to its own files would have to be shared | Results watch only (GitHub Actions); never shipped to browsers |
| LDNOOBW word list (English) | naughty-words 1.2.0 | CC-BY-4.0 (Shutterstock) | The slur entries of `apps/web/lib/moderation/wordlist.json` and the `moderation_term` table: selected terms and their plurals, copied as data, with the source named in the file. Attribution is the license's condition: keep the `source` field and tell the terms page if it is ever shown | Site build and database (words only; never shown to visitors) |
