# ADR 0058: The Account Center

**Status:** Proposed Nov 15, 2026; accepted when its pull request is merged. It extends ADR 0018 (fan accounts) and builds on
ADR 0053 (email alerts) and ADR 0054 (push alerts tied to the account). It changes nothing a signed-out visitor does.

## Context
- Signed-in fans can follow teams, get push and email alerts, and post, but nothing let them see or change what the site holds
  about them in one place: the display name was fixed for life, a linked browser could not be seen or removed, a team's alerts
  could not be silenced on one device, and there was no copy of their data.
- The rules that bind this are unchanged: the web app never uses a service key and acts on the visitor's own session (ADR 0018);
  the birth year is never shown or sent anywhere (ADR 0018); a push endpoint is a capability URL and is never shown or logged
  (ADR 0054); nothing logs an address, a year, a token or a database error.

## Decision
- **One hub page.** `/account` has sections with anchors: `#profile`, `#teams`, `#alerts`, `#security`, `#data`, `#activity`. On
  a desktop a sticky list of the sections sits on the left; on a phone the sections stack under an in-page jump list. No
  sub-routes, and the header's account link is unchanged.
- **Display name changes keep sign-up's rules and add a clock.** The same shape (3 to 24 characters), word list, reserved names
  and uniqueness as sign-up (`change_display_name` calls the same `moderation_*` checks as `create_profile`; the page runs
  `displayNameProblem` first for a quick answer), and at most one change every 30 days, enforced in the database
  (`profile.name_changed_at`, null until the first change, so the first change is free). Naming the name already held changes
  nothing and does not use the change. A refused name never uses the change. The page shows the date the next change opens. A
  banned account cannot rename itself. No `audit_log` row is written: that table is append-only and outlives the account, and a
  fan's own rename is not an owner override.
- **Devices are labels, never User-Agents.** When a browser is linked, the server derives a short label from the User-Agent
  header ("Chrome on iPhone", "Safari on Mac", "Firefox on Windows", otherwise "A browser", at most 40 characters of plain text)
  and stores only that. `push_subscription` gains `id` (a device id, so no endpoint is ever sent to a page), `device_label`,
  `linked_at`, and `muted`. The existing `updated_at` is "last used". A browser that leaves an account or moves to another one
  starts clean (a trigger resets its label, link date and mutes), so one account's label or mutes never reach the next.
- **Mute per team, per browser.** `push_subscription.muted` holds up to 100 team slugs. The sender
  (`tools/push/send-finals.mjs`) takes a muted team out of that browser's alert list, whether the browser or the account follows
  it; the account's other browsers and other teams are unaffected. The browser knows its own endpoint, sends it to the server,
  and the database matches it to `auth.uid()`'s own linked row. A run before the migration still sends, without mutes, and says
  so.
- **Email finals per team reuse what exists.** `email_set_optins('game_alerts', slugs)` and `email_my_settings()` (ADR 0053) are
  the whole of it; there is no new email table. With `EMAIL_ALERTS` off the control shows disabled with a plain note.
- **Remove a device** deletes that subscription row (the caller's own only); alerts to that browser stop.
- **Sign out of all devices** first removes every linked device of the account (`remove_all_my_devices()`, matching the
  sign-out rule of ADR 0054), then ends every session with Supabase's global sign-out.
- **Download my data** is one JSON attachment (`GET /api/account/export`, `txsixmanfootball-my-data.json`, never cached). It holds:
  the display name, the date joined and the date the name last changed; the person's own email and how they sign in (from Auth,
  added by the route); follows; devices (label, linked, last used, muted teams); email settings (the kind and team, never the
  unsubscribe token); and posts: comments, forum threads, forum replies and score reports, with their text and dates, including
  any a moderator hid (flagged `hidden`, because they are the person's own words). It **never** holds the birth year (a
  sentence says it is stored, to check age at sign-up and for email alerts, and is never shown to anyone), push endpoints or
  keys, or unsubscribe tokens.
- **My activity** lists the person's comments, forum threads and replies, and score reports, newest first, each linked to its page.
  It shows only what the public could see of those posts (a hidden post, a banned account's posts, and replies in a hidden
  thread are left out, as the public reads leave them out). The whole section is hidden while posts are off (`FAN_POSTS`).
- **Delete account** is unchanged: it already removes devices (migration 0023 and the cascade). Only the page's wording changes.
- **Where it lives.** Migration 0026 adds the columns, one trigger and eleven signed-in functions (`my_account`,
  `change_display_name`, `label_push_subscription`, `my_devices`, `this_device`, `remove_my_device`, `remove_all_my_devices`,
  `set_push_mute`, `my_push_mutes`, `export_my_data`, `my_activity`), all security definer, pinned `search_path`, acting on
  `auth.uid()`'s own rows, revoked from public and granted to the signed-in role only, and listed in `SIGNED_IN_FUNCTIONS`.
  The site's one server module is `apps/web/lib/account/center.ts`; its routes are `/api/account/export`,
  `/api/account/push-mute` and `/api/account/this-device` (all in `proxy.ts`'s matcher), and `/api/push/link` also labels the
  browser it links.

## Consequences
- A fan can fix a typo or change a name once a month, see and remove their browsers, quiet one team on one device, and take
  their data with them. The names on earlier posts change with it (the name is read live from the profile).
- The 30-day clock is the only thing standing between a name and a different name: it is a nuisance limit, not an identity
  guarantee, and the reserved and word-list checks still apply to every change.
- A label is a convenience, not a fingerprint: a browser that is not Chrome, Safari, Firefox, Edge or Samsung Internet is "A
  browser". The label is recomputed at each link, so it follows a browser's own update.
- The endpoint-to-device step means the page's script holds the only copy of an endpoint it ever sees (its own); the server and
  the database use it as a key and never return it.
