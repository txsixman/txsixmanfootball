# ADR 0001: Stack

**Status:** Accepted, Nov 10, 2026 (the owner). Decision 1 in the plan.

## Decision
Next.js (App Router, TypeScript, Tailwind) as an installable PWA on Vercel Pro. Supabase Postgres for data, auth,
row-level security and realtime. A Python 3.12 worker for ratings and simulations. Postgres queue (pgmq) and
pg_cron for jobs. Cloudflare for DNS and Turnstile. Web Push through a service worker. Sentry and Plausible.

## Why
- History pages need server rendering for search traffic.
- Six-man history is relational, so SQL fits it better than a document store.
- One platform for data, auth and realtime keeps a one-person operation small.
- Numpy, scipy and PyMC make the censored-margin model practical.

## Consequences
- Anonymous readers must never hit the database directly: scoreboards are CDN-cached JSON.
- **Cloudflare is DNS-only (no proxy) in front of Vercel, and Turnstile still runs on write paths.** Scoreboard JSON
  is cached by Vercel's CDN. This changes plan Figure 3: Vercel's docs advise against a reverse proxy because it weakens
  its firewall and bot detection, hides real client IPs, and adds latency and cache problems.

## Alternatives
Firebase is weaker for relational history. FastAPI + Postgres means more infrastructure to run alone.
