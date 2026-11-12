# Admin console v1

Backlog item 6 (data half). The owner, signed in, can **correct a game** and **merge two programs**. Every edit leaves an
audit row, and shows on the site after the next build. Nothing else: no score entry, no game-night queues (Phase 3).

Sign-in is a shared foundation (`apps/web/lib/auth/`, the `/sign-in` page, the `/auth/callback` route). The console sits
on top of it; fan accounts will too (ADR 0018), in a later round.

## What it does

| Page | Job |
|---|---|
| `/admin` | Find a game by team and/or date (any season 2021 on), then open it |
| `/admin/games/<game id>` | Fix the score, mark a forfeit (and who won it), or void a game listed in error. Needs a public `https://` page that shows the right fact, and a reason |
| `/admin/merge` | Say that a spelling the results use (no league lists it) is a listed program. Both names then show as one program |
| `/admin/corrections` | Every past correction, newest first, live from `main` |
| `/admin/moderation` | Fan posts hidden by flags (with their text) and muted or banned accounts: show a post again, lift a mute, ban or unban, each with a reason. Live from the database (migration 0013's `admin_*` functions, which check `is_admin()` and write the audit row themselves) |

There is no link to `/admin` from any public page. Every admin page is rendered per request (`force-dynamic`), carries
`Cache-Control: no-store` (`proxy.ts`, and Next's own `private, no-cache, no-store` on dynamic pages) and is `noindex`.
The service worker never keeps `/admin`, `/auth/*`, `/sign-in` or `/account*` (`lib/never-cached.ts`: the list to extend).

## How a fix reaches the site

The site reads files, and robot-written files are never hand-edited. So a fix is a **commit to `main`** that appends a row
to a file under `data/corrections/` (the only paths the console can write):

- `data/corrections/games.csv`: `game_date,home,away,action,home_score,away_score,source_url,reason,corrected_on`.
  `action` is `score`, `forfeit` (recorded 1-0 or 2-0 to the winner, which the pages and the ratings already read as a
  forfeit) or `void`. A game is found by its date and the two teams. The LAST row for a game wins; earlier rows stay as history.
- `data/corrections/programs.csv`: `name,same_as,source_url,reason,corrected_on`. `name` is a spelling the game files use;
  `same_as` is the listed program. It renames every game row that uses `name`, in every season, before anything else
  reads it, so pages, standings, records, game pages and the ratings all see one program. A name cannot be merged into a
  name that is itself merged (no chains).

Both files are validated by Zod (`lib/data-schemas.ts`, checked by `scripts/check-data.mjs` in CI and the robot workflows)
and read by two twins that must agree: `lib/corrections.ts` (the site; `lib/games.ts`, so game pages, results, standings,
records and brackets) and `services/ratings/corrections.py` (the ratings, through `rows.read_files`). One shared table,
`apps/web/lib/correction-cases.json`, is tested by both. A void game is gone everywhere, and has no game page.

**A correction never names a winner and never confirms a score** (ADR 0011). A corrected score is shown like every
robot-read score: unconfirmed, no winner named. A forfeit shows the word, never the score (ADR 0004).

Order of an edit, in `lib/admin/edit.ts`: (1) check the admin, (2) validate every input, (3) read the live files from
`main` and check the game or names exist, (4) write the `audit_log` row, (5) commit to `main`. If the commit fails, a second
audit row says `NOT APPLIED` (the log is append-only, so it is corrected forward), and the page says nothing was saved.
The write uses the file's blob sha, so if the Results watch robot (or another edit) commits in between, GitHub refuses
and the console reads again and re-applies the edit, three times at most.

The merge to `main` triggers the usual chain: CI, the ratings table commit, the Vercel deploy (it watches `data/`).

## Environment variables

Set in Vercel (project `txsixmanfootball.com`), **Production only**. Never in the repo: `.env*` is gitignored. Missing any
of them closes the console: `/admin` says "Admin is not configured" and shows nothing.

| Variable | Public? | What it is |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | public by design | The Supabase project's API URL, `https://vhgnaihnyjdnaaergtcl.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public by design | The project's `anon` (publishable) key. It only opens what row-level security allows |
| `ADMIN_USER_ID` | **server only** | The owner's Supabase Auth user id (a UUID). The one id the console lets in |
| `GITHUB_CORRECTIONS_TOKEN` | **secret, server only** | A fine-grained GitHub token, contents read and write on `txsixman/txsixmanfootball` only |

Never use the Supabase `service_role` key anywhere in this: the console acts as the signed-in person, with their own session.
`NEXT_PUBLIC_*` values are fixed into a build, so redeploy after setting them.

## The owner's one-time setup

1. **Create your user.** Supabase dashboard, project `vhgnaihnyjdnaaergtcl`, Authentication, Users, Add user, Create new
   user: your email, tick Auto Confirm. (No password is needed: sign-in is an emailed link.) Copy the new user's **UID**.
2. **Set the URLs.** Authentication, URL Configuration: Site URL `https://txsixmanfootball.com`; Redirect URLs add
   `https://txsixmanfootball.com/auth/callback` (and `http://localhost:3011/auth/callback` if you want to sign in on a local
   dev server). The Email provider stays on. Open the emailed link in the same browser (the same phone) that asked for it:
   the sign-in is tied to that browser.
3. **Make the token.** GitHub, signed in as the `txsixman` account: Settings, Developer settings, Fine-grained personal
   access tokens, Generate new token. Resource owner `txsixman`; Only select repositories: `txsixmanfootball`;
   Repository permissions: **Contents: Read and write** (Metadata read is added for you); nothing else. Expiry 90 days
   (put a reminder in your calendar). Store it: a password manager or Keychain, never in the repo or a chat.
4. **Add the Vercel env vars** (Project, Settings, Environment Variables), Production only, the last two marked Sensitive:
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `ADMIN_USER_ID` (the UID from step 1),
   `GITHUB_CORRECTIONS_TOKEN`. Then redeploy.
5. **Let the database know you are the admin.** After the migration `0010_admin.sql` has loaded (any push to `main`
   runs `supabase.yml`), run once, with your UID, in the Supabase SQL editor (or `pg`, as in `CLAUDE.md`):

   ```sql
   insert into admin_user (user_id) values ('PASTE-YOUR-UID-HERE');
   ```

   The migration inserts nobody. Until this row exists, the console loads but every audit call is refused, so no edit
   can be saved: that is the fail-closed state.
6. Go to `https://txsixmanfootball.com/sign-in?next=/admin`, ask for the link, open it on the same device.

**You do not need to turn public sign-ups off.** Fan accounts will open sign-ups later, and the console is safe either way:
a stranger who signs in is not `ADMIN_USER_ID` (the server turns them away before any data loads), and is not in
`admin_user` (the database refuses their audit call, and an edit writes its audit row before anything else). Both checks
must pass; neither depends on who may sign up. The sign-in page does not create accounts today anyway
(`shouldCreateUser: false`): only a user that already exists gets a link.

## Security notes

- **One id enters.** Every admin page, server action and route handler calls `adminState()` / `requireAdmin()`
  (`lib/auth/admin.ts`): `supabase.auth.getUser()` (Supabase verifies the token; `getSession()` is never trusted), then the
  id must equal `ADMIN_USER_ID`. Server actions are public POST endpoints, so each checks again, not just the page.
- **Database.** Migration `0010_admin.sql`: `admin_user` (RLS on, no policy, no grant), `is_admin()` and
  `record_admin_audit(entity, entity_id, before, after, reason)` (both security definer, `search_path` pinned, only
  `authenticated` may run them). The audit function refuses anyone who is not in `admin_user` (before it touches the id
  sequence, so a refusal burns no id), bounds what a row may hold, and sets `actor` from the caller's session, so a row
  cannot name someone else or be back-dated. Nobody has any right on `audit_log` itself: no table or column grant, no
  sequence use, no policy; its triggers also refuse update and delete for everyone. `supabase.yml`'s live check
  (`checkLive` in `packages/db/load.mjs`) asks Postgres what each API role effectively holds (PUBLIC grants included) on
  every table, view and sequence in `public` and `ops`, and every function in them, and fails on anything beyond the
  push pair and the signed-in functions.
- **Sessions.** The auth cookies last 30 days (`maxAge`), and the token inside is refreshed by the proxy on each visit.
  Signing out ends this browser's session only (`scope: "local"`); other devices stay signed in until their cookies age out.
- **Sign-in answers.** The "link sent" answer is the same for an address with an account, one without, and a rate-limited
  one (429); only a Supabase server failure (5xx) says it could not send.
- **Spreadsheet-safe files.** The correction files are plain CSV with no quoted cells. No field may hold a comma, a double
  quote or a line break, or start with `=`, `+`, `-` or `@` (a spreadsheet would run it as a formula). The console turns
  commas into semicolons, quotes into apostrophes (`%22` in a URL) and strips a leading formula character from free text;
  the schema refuses anything left. The ratings reader reads with no quoting, so a stray quote cannot swallow the rows
  below it (`correction-cases.json` holds the shared case).
- **Cookies.** Supabase's auth cookies are httpOnly (the site has no browser Supabase client), Secure in production and
  SameSite=Lax (`lib/auth/config.ts`). Nothing logs an email address, a code or a token.
- **Writes are narrow.** The GitHub client can write only `data/corrections/games.csv` and `data/corrections/programs.csv`,
  chosen by name in code; it can read only those and the season game and alignment files it searches. GitHub cannot limit a
  fine-grained token to a folder, so the token itself can change any file in the repository: keep it short-lived and
  repository-only, and treat a leak as a repository compromise (revoke it in GitHub).
- **Open redirects.** After sign-in the browser goes only to a local path (`safeNext`); the sign-in link's own address is this
  site's (`siteOrigin`), never taken from a request.

## Not built yet (on purpose)

- Fan sign-up, profiles and pages (`/account`): the foundation is ready, the pages are a later round (ADR 0018).
- A Google button. Slot: `OTHER_METHODS` in `app/sign-in/page.tsx`. When the owner has made the Google OAuth client (Supabase,
  Authentication, Providers, Google), add a server action that calls `signInWithOAuth({ provider: "google", redirectTo:
  <origin>/auth/callback })`; the callback already handles the code Google brings back.
- The Supabase loader (`packages/db/load.mjs`) does not read `data/corrections/`. The site does not read the database yet;
  when it does, apply the same corrections there.
- Un-merging: a later `programs.csv` row for the same name can point it somewhere else, but cannot remove it; delete the row
  by hand in a normal PR.
