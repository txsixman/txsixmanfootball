# ADR 0052: Posts have their own switch, in the site and in the database

**Status:** Proposed Nov 14, 2026; accepted when its pull request is merged. It adds a second switch under ADR 0018's fan
accounts and changes nothing else ADR 0018 decided.

## Context
- The fan launch is sign-in and follows first. Forums, game comments and fan score reports open about a week later.
- Until now one flag, `FAN_SIGNIN`, turned on accounts and every posts surface together.
- The site makes every Supabase call on the server, with the visitor's session cookie. That does not close the posting
  functions, because three things are public: the project's address, the anon key (it ships to every browser as
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`) and, to a signed-in fan, their own session. A fan can read their own cookie in the
  browser's tools and call `add_comment`, `create_thread`, `reply_to_thread`, `submit_score_report`, `flag_post` or
  `edit_post` straight at Supabase, past every route of the site, so a flag read by the site's routes cannot stop them. The
  functions (migrations 0013 to 0015) were granted to `authenticated` on purpose; only a banned or muted account, a bad
  text or a rate limit refused them. With sign-up open for the launch, anyone can become `authenticated`.

## Decision
- **A new server-only flag, `FAN_POSTS`,** read per request like `FAN_SIGNIN` (`fanPosts()` in `lib/auth/config.ts`). It
  must be exactly `on`, and it means nothing unless `FAN_SIGNIN` is on too: `fanPosts()` is `fanSignIn() && FAN_POSTS === "on"`.
  Never a `NEXT_PUBLIC` constant.
- **What it gates:** `/forums/**` (404), every route under `/api/fan` (comments, replies, threads, posts, flag,
  reports and `/api/fan/me`: a bare 404 before a session is read), `/api/games/[id]/comments` and
  `/api/games/[id]/score-report` (404), and the comment and score-report blocks of a game page. The game page is static, so
  it reads the flag when it is built, as it read `FAN_SIGNIN` before (flip it and redeploy); a page built with posts on
  that is served after the flag goes off hides both blocks itself when its routes answer 404.
- **What stays on with `FAN_SIGNIN=on` and `FAN_POSTS` off:** sign-in, `/account`, the profile, follows, `/privacy`, `/terms`
  and `/api/me`, exactly as before. Every posts surface answers as it does with fan accounts off.
- **`/api/me` hands the flag to the page scripts** as `posts: boolean` in every answer (never true while `enabled` is false).
  Nothing reads it yet; it is there so a later header or menu link to the forums can follow the switch without a rebuild.
- **The owner's moderation page stays open.** `/admin/moderation` is behind the admin gate, so it is not a public surface. Hiding it
  while posts are off would leave the owner unable to ban an account or show a post again exactly when something went wrong
  and he turned posts off. It keeps working, says in one sentence that posts are off, and shows a post's place as plain text
  instead of a link to a forum or game page that answers 404.
- **The database has its own switch (migration 0024).** A one-row table, `site_switch`, with the row `posts`, closed
  (`is_on = false`) until the owner opens it with `update site_switch set is_on = true where name = 'posts'`. Row-level
  security, no policy, no grant: the API roles cannot read or change it, nor delete or truncate it. Every change writes an
  `audit_log` row. All six functions that write something (`add_comment`, `edit_post`, `flag_post`, `submit_score_report`,
  `create_thread`, `reply_to_thread`) already begin with `fan_actor()`, so the migration redefines only that function, to
  raise `posts_closed` first of all, before it looks up a profile, takes a lock or reads a count. No other function changes.
  A test asserts that each of the six still goes through `fan_actor()`.
- **What the database switch leaves alone:** the public reads (`list_comments`, `fan_score_status`, `forum_*`), the owner's
  `admin_*` functions, and everything about accounts and follows. Reads return only what is already public and visible; with
  posts never opened there is nothing to read. If posts are turned off after use, what was visible stays readable by a
  direct call until the owner hides it; that is accepted, since the switch is meant to stop new writes, not to unpublish.
- **Opening posts is two steps, in this order:** set `site_switch` open in the Supabase SQL editor, then set `FAN_POSTS=on` in
  Vercel and redeploy. Closing is either one. If only the database is closed, the routes answer `posts_closed` (403, "Posting
  is not open yet."); if only the site is closed, the routes answer 404. Neither mismatch lets a post through.

## Consequences
- With the switch closed, a fan with a real session cannot post by any route. A test calls every posting function as an
  established fan with a profile and checks each is refused and nothing is stored.
- The migration ships closed: merging it changes nothing a visitor can do today, since no posts surface is open yet.
- A fresh test database has posts closed; `packages/db/test/posts-helpers.mjs` opens the switch for the posts tests, and the
  new `posts-switch.test.mjs` covers closed, open, closed again, the audit rows and the locked table.
- The owner has two switches to flip for posts instead of one flag; the docs say which order. The cost is accepted: one switch
  cannot be both read by the site and trusted by a caller who bypasses it.
- A signed-in fan can still call the public reads and the follow functions directly; those were already public by design.
