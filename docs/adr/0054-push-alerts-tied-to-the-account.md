# ADR 0054: Push alerts tied to the account

**Status:** Proposed Nov 14, 2026; accepted when its pull request is merged. It extends ADR 0018 (fan accounts) and the
push alerts of migration 0008; it changes nothing a signed-out browser does.

## Context
- Web push was per browser: `push_subscription` (migration 0008) holds one browser's endpoint, keys and the program slugs
  it follows, with no account. A fan's account follows (migration 0012) were a separate list, so following on a phone
  gave the laptop no alerts.
- Supabase's auth cookies are httpOnly, so the page's script cannot call the database as the fan. Every database call
  that needs `auth.uid()` goes through the site's server on the visitor's own session (ADR 0018, no `service_role`).
- A push endpoint is a capability URL: whoever holds it can push to that browser. It is treated as a secret.

## Decision
- **Link.** `push_subscription.user_id` (nullable, references `profile` on delete cascade). When a signed-in fan's browser
  has or makes a push subscription, the page posts it to `POST /api/push/link` (same-site, JSON, session), which calls
  `link_push_subscription(endpoint, p256dh, auth)` on the fan's own session. The database sets `user_id = auth.uid()`;
  no user id comes from the browser. The Follow button links on a tap (asking permission if needed) and once per visit
  for a browser that already shows alerts (never asking). Needs a finished profile; at most 5 linked browsers per
  account (a sixth replaces the least recently active); the full-table rule of migration 0018 applies to new rows.
- **The browser's own follows are merged into the account** at link time, not kept beside it. If they were kept, an
  unfollow on another device would not stop the alert on this one, and "the account's follows drive alerts" would be
  false. Nothing is lost: a program already on the account is skipped; one that does not fit (the account already
  follows 100) stays on this browser's own list, which the function returns and the page keeps; an account unfollow
  also strips the program from the account's linked browsers' own lists (`unfollow_program` replaced). Because
  `programs` may now be empty on a linked row, its check is relaxed to 0 to 25, with a second check that an unlinked row
  still has at least one program.
- **One alert a browser.** The sender (`tools/push/send-finals.mjs`) reads one row per subscription with its programs =
  its own list joined with the account's follows when linked, each program once, so a browser that follows a team both
  ways, or two teams that played each other, gets one message. Every linked browser of an account gets its own alert.
  Unlinked rows behave exactly as before. If the database does not have the column yet (a run before the migration),
  the sender falls back to the own-programs query and prints a warning, so alerts never stop on ordering.
- **Sign-out unlinks, and deletes the row.** The sign-out button reads this browser's own endpoint from its push
  registration and sends it in the sign-out form; `signOut()` calls `unlink_push_subscription(endpoint)` before ending
  the session. The function matches the endpoint to `auth.uid()`, so naming another account's or a made-up endpoint
  changes nothing. It deletes the row, because the account's alerts must stop on that browser and, after the merge, the
  browser has no follows of its own that an unlinked row could serve; leaving the address stored under no account
  would only keep a capability URL we cannot use. The one exception is leftover own-list programs (the full-account
  case above): then the row stays, unlinked, for those alone, so no follow is lost. Unlink never fails sign-out. A
  session that has already expired cannot unlink; the row then goes when the push service reports it gone, with the
  account, or when another account links that browser.
- **Delete the account** deletes its push subscriptions twice over: `on delete cascade` from `profile`, and explicitly
  in `delete_my_account()`, which migration 0023 replaces (`create or replace`) keeping everything migrations 0011 and
  0012 do (profile, Auth flow state, Auth audit entries, Auth user).
- **A browser linked to another account** changes hands without handing over what the first account followed.
- `push_follow` and `push_unfollow` are unchanged. "Stop alerts" signed out still deletes the row it names.
- **Privacy.** No endpoint, key or user id is logged anywhere (the route, the action, the sender logs hosts only);
  the link route's answer holds only program slugs; the API roles still have no table rights, and the two new functions
  are signed-in only (`SIGNED_IN_FUNCTIONS`, checked by `checkLive`).

## Consequences
- Following on any device alerts every linked browser of the account; signing out of a browser stops them there.
- A linked browser's endpoint is stored with an account id. It is erased with the account and on sign-out.
- A signed-out follow on a browser whose session expired still works per browser and is merged at the next link.
- The Follow button's signed-in order is link first, then the account change, so a stale own list is never merged after
  an unfollow. If linking fails, Follow still follows on the account and says alerts did not change; Unfollow stops.
- Linking happens where the Follow button is (program pages). A browser is linked the first time its fan visits one.

## What `docs/fan-accounts.md` should say (another change owns the file)
- Under "How it works": migration 0023 `push_subscription.user_id`, `link_push_subscription` and
  `unlink_push_subscription` (signed-in, in `SIGNED_IN_FUNCTIONS`), `unfollow_program` and `delete_my_account`
  replaced; `POST /api/push/link` (same-site `Origin`, JSON, session; answers the programs left on the browser).
- "Program page" row: signed in, the Follow button also links this browser's alerts to the account, so follows on any
  device alert every linked browser; "Account" row: Sign out stops the account's alerts on that browser, Delete my
  account removes its push subscriptions.
- Replace "Push alerts stay per browser" wherever it appears; signed-out browsers are unchanged.
