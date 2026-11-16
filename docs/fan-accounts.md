# Fan accounts and following

ADR 0018. Fans sign in with an emailed link or Google, pick a display name and give a birth year, and can follow teams on
their account. Forums, game comments and score reports sit on the same profile and have their own switch, `FAN_POSTS`
(ADR 0052), so they can open about a week after sign-in and follows.

Sign-in itself is the shared foundation (`apps/web/lib/auth/`, `/sign-in`, `/auth/callback`, `proxy.ts`); the admin console
uses it too (`docs/admin-console.md`). Every Supabase call is made on the server with the visitor's own session cookie
(httpOnly, so no browser client exists). Never the `service_role` key.

## The switch: FAN_SIGNIN

Fan accounts are **off by default**. With `FAN_SIGNIN` missing (or anything but exactly `on`) the site is as it was:
no "Sign in" link in the header, `/sign-in` is only the email form for accounts that already exist (the owner's way into
`/admin`; no Google button, no sign-up wording), `/account` and `/account/welcome` send everyone home, `/account/too-young` answers 404 (`/privacy` and `/terms` are always public, linked from the site footer), `/api/follows`
answers 404, the Follow button is the browser-only button, and `/api/me` answers `{ enabled: false, posts: false, me: null }` without
asking Supabase (except for a request that comes from an `/admin` page). The flag is read per request on the server and
handed to the pages' scripts through `/api/me`, never a `NEXT_PUBLIC` constant: set it in Vercel and redeploy. The header,
Follow button and `/api/*` follow it with no rebuild of the pages; the one exception is the static game page (see `FAN_POSTS` below). Everything below describes the "on" state.

### The second switch: FAN_POSTS (ADR 0052)

Forums, game comments and score reports are behind `FAN_POSTS`, which must be exactly `on` **and means nothing unless
`FAN_SIGNIN` is on too** (`fanPosts()` in `lib/auth/config.ts`; server-only, read per request, never `NEXT_PUBLIC`).

| `FAN_SIGNIN` | `FAN_POSTS` | What exists |
|---|---|---|
| not `on` | anything | The site as it was. `FAN_POSTS` alone opens nothing |
| `on` | not `on` | Sign-in, the profile, `/account`, `/privacy`, `/terms`, follows and `/api/me`. Every posts surface answers as it does with fan accounts off: `/forums/**` and every `/api/fan/**` and `/api/games/[id]/comments`, `/score-report` route is a bare 404, and the game page has no comment or score-report block |
| `on` | `on` | Everything in this document, posts included |

- **A game page (`/scores/<id>`) is static** (`generateStaticParams`, `dynamicParams = false`), so it reads `FAN_POSTS` (and
  `FAN_SIGNIN`) **at build time**, not per request. Flipping either in Vercel needs a redeploy, which rebuilds the pages: the
  comment and score-report blocks appear or vanish only with that deploy. CI's launch job builds with the switches set, as Vercel does.
  A page built with posts on and served after the flag goes off hides both blocks itself, because their routes then answer 404.
  The forums, every `/api/*` route and `/api/me` read the flag per request.
- **`/scores` and the playoff lists are static too**: their comment counts and comments links (ADR 0077) are in a build made with posts on and absent from one made with posts off, so they never ask the counts route while posts are off. A page built with posts on and served after the flag goes off draws nothing, because the route then answers 404.
- `/api/me` answers `{ enabled, posts, me }`: `posts` is `FAN_POSTS` for the page scripts, never true while `enabled` is false.
- **`/admin/moderation` stays open to the owner** whichever way the switch is set, so he can ban an account or show a post again
  after turning posts off. With posts off it says so in one sentence and shows a post's place as text, not a link.
- **The database has its own switch.** The site's routes are not the only way in: the posting functions are granted to signed-in
  users, and the anon key and the project's address are public, so a fan can call them straight at Supabase with their own
  session. Migration 0024 adds the one-row table `site_switch` (row `posts`, closed by default, no policy and no grant for the API
  roles, every change written to `audit_log`) and `fan_actor()`, which every function that writes a post, thread, reply, flag, edit
  or score report calls first, raises `posts_closed` while it is closed. Public reads and the owner's `admin_*` functions are not
  behind it.
- **To open posts, in this order:** (1) Supabase dashboard, SQL editor, run
  `update site_switch set is_on = true where name = 'posts';` (2) Vercel, set `FAN_POSTS` to `on` (Production) and redeploy. To close
  them, undo either one (`is_on = false`, or remove `FAN_POSTS` and redeploy); the closed one wins. Only the database closed: the
  routes answer `posts_closed` ("Posting is not open yet."). Only the site closed: 404. Either way nothing is posted.

## Launch checklist: opening posts (about Sun Nov 22, 2026)

Do these in order, in one sitting. Each step names how to check it worked.

**Before (any day that week)**
1. `main` has migration 0027 (ADRs 0060 to 0062) and the `Supabase` workflow run after it passed. Check in the Supabase SQL editor
   (project `vhgnaihnyjdnaaergtcl`): `select to_regprocedure('admin_mute(uuid,integer,text)') is not null as ready;` answers `true`.
2. Production already has `FAN_SIGNIN=on` and `/api/me` answers `"enabled":true,"posts":false`.
3. The owner's own account can open `/admin/moderation` and `/admin/corrections` (he needs both the first night).

**Open (about 15 minutes, most of it the redeploy)**
1. Supabase SQL editor: `update site_switch set is_on = true where name = 'posts';` Check:
   `select is_on from site_switch where name = 'posts';` answers `true` (the change is in `audit_log`, entity `site_switch`).
2. Vercel, project `txsixmanfootball.com`, Settings, Environment Variables, **Production**: add `FAN_POSTS` with the value `on`
   (exactly, lower case). Nothing else changes: `FAN_SIGNIN` stays `on`.
3. Redeploy production (Deployments, the latest production deploy, Redeploy; leave "use existing build cache" off). The game pages
   are static and only a new build adds their comment and score-report blocks (see "The second switch").
4. Check, signed out: `/api/me` answers `"posts":true`; `/forums` lists the five boards; a game page shows Comments.
5. Check, signed in on a fan account with a finished profile: post one comment on a game page and see it show. It
   can stay, or be edited. Then open the game page signed out and check its Report link goes to sign-in.

**Watch the first night (Friday games: 7 PM to midnight Central)**
- `/admin/moderation`, Reported posts: anything reported once or twice that should go, hide it; an account doing it again, mute
  it (1 to 90 days) or ban it. Every one asks for a reason and lands in `audit_log`.
- `/admin/corrections`, Fan score reports: reports that differ from the final, marked "differs from the final". A real error is
  fixed with the game's correction form, as any correction; a report never changes a score by itself.
- Errors: `vercel logs --environment production` (the CLI, outside the sandbox) and look for `posts: database call failed`,
  `comments: read failed`, `forums: read failed` or `score report: read failed`. Each line carries only a database error code.
  More than a few a minute means the database is struggling: close posts (below) and look in the morning.
- Volume, in the SQL editor: `select count(*) from post where created_at > now() - interval '1 hour';` and the same for
  `post_flag` and `fan_score_report`. Every account is limited per minute, per 10 minutes and per day (ADR 0060), so a flood means
  many accounts: close posts and look.

**Turn posts off fast**
1. **Seconds, no deploy:** Supabase SQL editor, `update site_switch set is_on = false where name = 'posts';` Every write
   (comments, threads, replies, edits, reports, score reports) is refused at once with "Posting is not open yet." What is
   already posted still shows.
2. **To hide the pages too:** Vercel, delete `FAN_POSTS` (Production) and redeploy. The forums and every posts route answer 404,
   and a game page built with posts on hides its blocks once the new deploy is live (their routes then answer 404). A Vercel
   variable change applies only to a new deploy, so step 1 is the fast one.
3. Moderation still works while closed: `/admin/moderation` stays open to the owner.
4. To reopen, undo whichever you did. The closed one wins.

## What a fan sees

| Where | What |
|---|---|
| `/sign-in` | "Continue with Google" (whenever `FAN_SIGNIN` is on). The email link: for new fans only when `FAN_EMAIL_SIGNIN=on`; otherwise it sits behind "I already have an account" and only existing accounts get a link |
| `/account/welcome` | Last step of sign-up: display name (3 to 24 characters) and birth year. Exactly 13 years back asks "Have you had your 13th birthday?" (used once, never stored). Under 13 deletes the account at once and shows `/account/too-young`. Anyone signed in without a profile is sent here first (`/auth/callback` after sign-in, and the header from any other page) |
| `/account` | Display name, date joined, Sign out (it also stops the account's alerts on that browser, ADR 0054), Delete my account (a confirm step, then `delete_my_account()`, which also removes the account's push subscriptions), and an offer to copy this browser's follows into the account |
| `/privacy`, `/terms` | Plain language, linked from `/sign-in`, `/account/welcome` and `/account` (and the site footer, on every page, whichever way `FAN_SIGNIN` is set) |
| Header | "Sign in", or the display name. Filled in by the page's own script from `/api/me`, so static pages stay static |
| Program page | The Follow button: signed out, push alerts on this browser as before; signed in, it also follows on the account (and still follows on the account where the browser cannot show alerts) and links this browser's push alerts to the account, so a follow on any device alerts every linked browser (ADR 0054) |
| Home, My teams | The account's follows when signed in, else this browser's |
| `/forums`, a board, a thread | Only while `FAN_POSTS` is on (otherwise 404). Anyone reads; a signed-in fan with a profile posts, replies, edits their own and flags others |
| A game page | Only while `FAN_POSTS` is on: the comments block (it checks for new comments once a minute while the tab is visible and offers "Show N new comments" rather than moving the list), and for a game with no score yet the fan score-report block. With it off the page is as it was |
| `/scores` | Only while `FAN_POSTS` is on: a game with comments shows "1 comment" or "N comments" with a small icon at the bottom of its score card (plain text; the card is one link to the game page). Nothing for a game with none, while the number loads, and with posts off (ADR 0077) |
| `/playoffs/this-round`, `/playoffs`, a bracket page | Only while `FAN_POSTS` is on, for a current-season game that has its own page (a game a bracket only sets has none): a link under the game, on its own line, to the game's comments (`/scores/<id>#comments`). On this-round it reads "Comments" for a game with none, "1 comment" or "N comments" otherwise, with a small icon; on `/playoffs` and the bracket pages only a game that has comments shows one. Each link's accessible name names its game ("3 comments on Away vs Home"). Nothing while the counts load, with posts off, and when the request fails. Past seasons' lists have none. One counts request serves the whole page (ADR 0077) |

No age, birth year, email or school is shown anywhere. The birth year is stored in `profile.birth_year` and no function returns it.

## How it works

- **Migration 0011** `profile` (RLS, no policy, no grants) with `create_profile`, `my_profile`, `delete_my_account`.
  **Migration 0012** `follow(user_id, program_slug, created_at)`, RLS, no policy, no grants; `follow_program` (at most 100 per
  account, the slug's shape checked, a profile required), `unfollow_program`, `my_follows`, all `security definer` on `auth.uid()`'s
  own rows. `follow.user_id` references `profile` with `on delete cascade`, so deleting the account removes the follows.
  The three functions are in `SIGNED_IN_FUNCTIONS` (`packages/db/load.mjs`): CI checks anon cannot run them.
- **Comment counts on the score cards (ADR 0077, migration 0029).** `comment_counts(p_game_keys text[])` is a public read (in
  `ANON_FUNCTIONS`): per game key the number of comments `list_comments` would show (not hidden, author not banned), only keys
  with at least one, only the first 200 keys given; a key and a number, nothing else. `GET /api/games/comment-counts?keys=k1,k2,...`
  (404 while posts are off, before anything else) drops every key that is not a game page id, dedupes, takes at most 200 and
  answers `{ counts: { <key>: <n> } }` (nonzero only) with `Cache-Control: public, s-maxage=30, stale-while-revalidate=60`: a
  count can lag a new or hidden comment by about 30 seconds, and game night costs the database one read per distinct list of
  keys, not one per visitor. A database error is a 502 and logs only its code. `app/scores/comment-count.tsx` gathers every
  card's key on a page into one request (chunks of 200), asks again only for counts older than 30 seconds, and draws nothing on
  a 404 or a failure. `CommentCountLink` is the same count as a link to `/scores/<id>#comments`, for a row that is not
  already a link (a card that is a link holds the plain `CommentCount`: a link in a link is not valid HTML).
- **Server checks, then the database checks again.** Server actions and `/api/follows` validate with Zod, check the session
  (`getUser()` asks Supabase; never `getSession()`), and the database re-checks age, name shape, uniqueness, slug shape and the cap.
- `/api/me` (GET) answers `{ enabled, posts, me }`: `enabled` is `FAN_SIGNIN`, `posts` is `FAN_POSTS` (and `FAN_SIGNIN`); `me` is `null` when signed out, else
  `{ displayName | null, follows, admin? }` (`null` name = sign-up unfinished; `admin` marks the owner's account, which is never
  sent to fan sign-up). No email, id or birth year. `/api/follows` (POST: follow, unfollow, import up to 100) needs a same-site
  `Origin`, a JSON body and a session. Both are in `proxy.ts`'s matcher (session refresh, `no-store`, `noindex`); the service
  worker never keeps `/api/`.
- **Push alerts tied to the account (ADR 0054, migration 0023).** `push_subscription.user_id` (nullable, references `profile` on delete
  cascade) links a browser's subscription to an account; signed-out browsers behave as before.
  - **Link.** `POST /api/push/link` (same-site `Origin`, JSON, session; answers the program slugs left on the browser) calls
    `link_push_subscription(endpoint, p256dh, auth)` on the fan's own session; the database sets `user_id = auth.uid()`, no id comes
    from the browser. The Follow button links on a tap (asking permission if needed) and once per visit for a browser that already
    shows alerts. It needs a finished profile. **At most 5 linked browsers per account** (a sixth replaces the least recently active).
  - **Merge.** The browser's own follows are merged into the account at link time (a program the account already follows is skipped;
    one that does not fit under the 100 cap stays on the browser's own list). `unfollow_program` also strips the program from the
    account's linked browsers. The sender (`tools/push/send-finals.mjs`) sends one alert per browser: its own list joined with the
    account's follows, each team once.
  - **Unlink.** Sign-out reads the browser's own endpoint and sends it in the sign-out form; `signOut()` calls
    `unlink_push_subscription(endpoint)` before ending the session. It matches the endpoint to `auth.uid()` (another account's or a made-up
    endpoint changes nothing) and **deletes the row**, except that leftover own-list programs keep it, unlinked, for those alone. Unlink
    never fails sign-out; a session already expired cannot unlink, and the row then goes when the push service reports it gone, with the
    account, or when another account links that browser. Deleting the account removes its push subscriptions (`on delete cascade` and
    explicitly in `delete_my_account()`, replaced by 0023).
  - Both functions are in `SIGNED_IN_FUNCTIONS`. No endpoint, key or user id is logged anywhere.
- A display name is checked by `lib/moderation/names.ts` (a small word list) before `create_profile`. The posts round replaces
  that file and keeps `displayNameProblem(name)`.
- Nothing logs an email, a birth year, a token or a Supabase error.
- **Posts launch (migration 0027, ADRs 0060 to 0062).** Every write is also limited per minute (`fan_rate_check`; new accounts:
  posts 2, threads 1, reports of posts 3, score reports 2; established: 4, 2, 5, 3; the database raises one `rate_limited` for the
  1 minute, 10 minute and 24 hour windows, so the site's sentence is true for all three: wait a minute, else try again tomorrow). Gambling talk is refused in posts and titles
  (`moderation_betting`, the `betting` list in `lib/moderation/wordlist.json`, the shared vectors). Report shows on every other
  fan's post for every viewer: signed out it links to sign-in and back (from a game's comments, back to `#comments`); signed in it asks "Report this post to the moderators?" with Report and Cancel before it sends, because a report cannot be taken back. The owner's `/admin/moderation` lists every reported post
  that is not hidden (most reports first, how many count, never who reported) and can hide a post (`admin_hide_post`) or mute an
  account for 1 to 90 days (`admin_mute`), each written to `audit_log` with his reason. `/admin/corrections` lists fan score
  reports from the last 60 days (`admin_fan_score_reports`, read-only), marked where they differ from the final. All three
  functions are admin-only and in `SIGNED_IN_FUNCTIONS`.
- **A deleted account** (`delete_my_account()`): its posts and every earlier version of them, its reports of posts and its
  follows go; a thread it started goes with its replies; its score reports stay with no reporter (`reporter_id` set null), so a
  confirmed score does not change. `/privacy` says so.

## Environment variables (Vercel, project `txsixmanfootball.com`, Production)

| Variable | Public? | What it is |
|---|---|---|
| `FAN_SIGNIN` | server only | `on` turns fan accounts on (everything in this document). Missing or anything else: off, see "The switch" above. Redeploy after changing |
| `FAN_EMAIL_SIGNIN` | server only | `on` (and `FAN_SIGNIN` on) lets the emailed link make NEW fan accounts. Missing or anything else: the link works for existing accounts only (it is how the owner signs in to `/admin`) and new fans see only "Continue with Google". Google is never behind it, only behind `FAN_SIGNIN`. Custom SMTP through Resend is live (below), so this is unblocked: set it when you are ready for new fans to sign up by email. Redeploy after changing |

| `FAN_POSTS` | server only | `on` (and `FAN_SIGNIN` on) turns on forums, game comments and score reports. Missing or anything else, or `FAN_SIGNIN` off: they do not exist and sign-in and follows work as before. **Open the database switch first** (`site_switch`, see "The second switch" above). Redeploy after changing |

The Supabase variables are in `docs/admin-console.md`. Google needs no variable on the site: its client id and secret live in Supabase.

## Owner's setup: Google sign-in

1. **Google Cloud.** <https://console.cloud.google.com>, signed in with the Google account that should own this. Top bar,
   project picker, New project, name it `80x40`, Create, and make sure it is the selected project.
2. **Consent screen.** Menu, APIs & Services, OAuth consent screen (it may be called Google Auth Platform; Get started).
   - App name **TX Six-Man Football**; User support email: yours; Audience/User type: **External**;
     Contact email: yours.
   - Branding, Authorized domains: add `txsixmanfootball.com` and `supabase.co`. App home page `https://txsixmanfootball.com`,
     privacy policy `https://txsixmanfootball.com/privacy`, terms `https://txsixmanfootball.com/terms`.
   - Data Access (Scopes), Add or remove scopes: tick `.../auth/userinfo.email`, `.../auth/userinfo.profile` and `openid`. These
     three need no Google review.
   - Audience: **Publish app** (move it from Testing to In production). Left in Testing only the test users you list can sign in.
3. **Make the client.** Menu, APIs & Services, Credentials (Google Auth Platform: Clients), Create credentials, OAuth client ID.
   - Application type: **Web application**; Name: `80x40 web`.
   - Authorized JavaScript origins: `https://txsixmanfootball.com`
   - Authorized redirect URIs: `https://vhgnaihnyjdnaaergtcl.supabase.co/auth/v1/callback` (exactly this: it is Supabase's address, not the site's)
   - Create. Copy the **Client ID** and **Client secret** (the secret can be shown again later; keep it in your Keychain, never in the repo or a chat).
4. **Turn it on in Supabase.** Dashboard, project `vhgnaihnyjdnaaergtcl`, Authentication, Sign In / Providers, **Google**: switch
   Enable on, paste the Client ID and Client secret, leave "Skip nonce checks" off, Save. The Callback URL it shows must equal the
   redirect URI in step 3.
5. **Check the other Supabase settings.** Authentication, Sign In / Providers, User Signups: **Allow new users to sign up**
   stays **OFF** until the day you set `FAN_SIGNIN` to `on`, and goes on in the same sitting. The anon key is public, so with
   it on anyone can make an Auth user straight through Supabase, bypassing the site's flag, age question and checks; off,
   that is closed while fan accounts are off. **Make your own admin account first** (Authentication, Users, Add user, in
   `docs/admin-console.md`), before turning signups on. Authentication, URL Configuration: Site URL
   `https://txsixmanfootball.com`; Redirect URLs contain `https://txsixmanfootball.com/auth/callback` (and
   `http://localhost:3011/auth/callback` for local tests).
6. Try it: <https://txsixmanfootball.com/sign-in>, Continue with Google, pick the account, finish sign-up.

Google signs in by the account's verified email: if you use the same email as your admin user, Supabase links the Google
sign-in to that same user, so `ADMIN_USER_ID` still matches.

## Owner's setup: email sign-up for new fans (Resend)

Supabase's own email sender allows about 2 emails an hour, so new-fan email sign-up stays off until the project has its own sender.
**Done:** custom SMTP through Resend is live and the sender is `TX Six-Man Football <no-reply@txsixmanfootball.com>` (`EMAIL_FROM`, the same sender
the email alerts use, `docs/email-alerts.md`), so `FAN_EMAIL_SIGNIN` is unblocked. The steps are kept for rebuilding it.

1. Resend: verify the sending domain, make an API key.
2. Supabase, Authentication, Emails, SMTP Settings: Enable custom SMTP. Host `smtp.resend.com`, port `465`, username `resend`,
   password the Resend API key, sender an address on the verified domain. Save.
3. Authentication, Emails, Templates: **Confirm signup** and **Magic Link** must both still contain `{{ .ConfirmationURL }}`
   (the defaults do). New fans get the first, existing ones the second.
4. Send yourself a sign-in link and check it arrives and works.
5. Then set `FAN_EMAIL_SIGNIN` to `on` in Vercel (Production) and redeploy (unblocked now; it is the owner's call when).

## Before the pages are public

`/privacy` and `/terms` give `contact@txsixmanfootball.com` for questions and copyright notices, and say "DMCA agent
registration pending". When the owner has registered the agent with the US Copyright Office (ADR 0018), change that wording on
both pages to name the agent.

## Supabase keeps copies of a user: one setting for the owner

Deleting an Auth user does not remove `auth.audit_log_entries` (a log whose payload holds the email and IP) or
`auth.flow_state` (sign-in handshakes): they have no foreign key to `auth.users`. `delete_my_account()` (migration 0012) and
the unfinished-sign-up erase delete a user's rows in both tables first, where they exist. To stop the audit log keeping new
emails and IPs at all: Supabase dashboard, project `vhgnaihnyjdnaaergtcl`, Authentication, and, if the project offers it
(under Auth settings or Auth hooks/Advanced), the setting that turns off writing auth audit logs to the database. If it is
not offered, the erase above is what clears them.

## What the accounts round did not do

- The Follow-button screenshots: the header now ends with a "Sign in" link, so the
  CI screenshot baselines that include the header need the usual `screenshots/<anything>` branch to approve the new look.
- Push alerts were per browser here: ADR 0054 (above) later tied a signed-in browser's alerts to the account. A signed-out browser
  is still per browser (stopped with Stop alerts, or by blocking notifications).

## Unfinished sign-ups are erased

Every Supabase load (`packages/db/load.mjs`, after each push to `main` and every Monday) runs `purgeUnfinishedSignups` after
the security check: it deletes Auth users older than 7 days that have no fan profile, are not in `admin_user`, and were
created **after the first fan profile existed**. Before any fan has finished sign-up nothing is erased, so an account made
before launch (the owner's, even before his id is in `admin_user`) is never touched; make the admin account before turning
signups on. The site cannot mark who "started" fan sign-up, because anyone can create an Auth user directly through
Supabase, so the rule uses only the database. The user's `auth.flow_state` and `auth.audit_log_entries` rows go with them.
It reports a count only (`unfinishedSignupsRemoved`); a failure is reported as `purgeError` (the error code) and never fails
the load, so the security check always runs.

Not done here: reserved and slur display names enforced in the database (`create_profile`); the forums round adds them in
migration 0013. `lib/moderation/names.ts` keeps `displayNameProblem(name)` for the form.

## Account Center (ADR 0058)

- **Migration 0026** adds `profile.name_changed_at` and, on `push_subscription`, `id` (a device id), `device_label`, `linked_at` and
  `muted` (up to 100 team slugs), one trigger that clears a browser's label, link date and mutes when it leaves an account or
  moves to another, and eleven signed-in functions, all in `SIGNED_IN_FUNCTIONS`: `my_account`, `change_display_name` (sign-up's
  rules, once every 30 days), `label_push_subscription`, `my_devices`, `this_device`, `remove_my_device`,
  `remove_all_my_devices`, `set_push_mute`, `my_push_mutes`, `export_my_data` and `my_activity`. None returns the birth year, a
  push endpoint or key, or an unsubscribe token.
- The site's one server module is `apps/web/lib/account/center.ts` (plain data or `{ error }`, never a database message). Routes:
  `GET /api/account/export` (the JSON file), `POST /api/account/push-mute` and `POST /api/account/this-device` (same-site, JSON,
  session), all in `proxy.ts`'s matcher; `/api/push/link` also stores the browser's short label (`deviceLabel`, from the
  User-Agent, which is never stored).
- The sender skips a program a browser has muted (`tools/push/send-finals.mjs`).
