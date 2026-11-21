# Tokens and keys: where each lives and when it expires

One list, so an expiry is never a surprise. Values never go in the repo, a chat or a log; this page holds names and dates
only. Update a row in the same change that makes or rotates its token. A token that stops working shows as a failed run
(results watch, supabase load, email) or an admin page that says it is not configured, not as a warning.

| Name | What it opens | Lives in | Expiry |
|---|---|---|---|
| `GITHUB_CORRECTIONS_TOKEN` | The admin corrections form commits to this repo (contents read and write, this repo only) | Vercel env var, Production | 90-day token, expires around Feb 2027: renew before then (`docs/admin-console.md`, setup step 3) |
| `DATA_PRIVATE_TOKEN` | The private capture repo, read and write; push-to-main, schedule and dispatch runs only (ADR 0017) | GitHub Actions secret | Unknown, check in GitHub settings (Developer settings, fine-grained tokens, the token's expiry date) |
| `SUPABASE_DB_PASSWORD` | The hosted database role the loader and checks use | GitHub Actions secret; the owner's Keychain | A password: no expiry. Rotate only on a leak (`CLAUDE.md`) |
| `EMAIL_DB_PASSWORD` | The email jobs' own database role | GitHub Actions secret | A password: no expiry. Unknown whether one was set, check in the Supabase dashboard |
| `VAPID_PRIVATE_KEY` | Signs browser push alerts | GitHub Actions secret; the owner's Keychain | No expiry. Rotating it makes every follower tap Follow again (`tools/push/setup-vapid.mjs --rotate`) |
| `RESEND_API_KEY` | Sends email alerts and the weekly digest | GitHub Actions secret | Unknown, check in the Resend dashboard (API keys) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | The public (publishable) database key; it only opens what row-level security allows | Vercel env var | No expiry; public by design |

A token that is renewed gets a new expiry in the row above and the same name, so no workflow or variable changes.
