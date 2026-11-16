# ADR 0085: Follow on a browser that cannot show alerts, and the owner's reach over posts nobody reported

**Status:** Proposed Nov 16, 2026; accepted when its pull request is merged. It adds to ADR 0054 (alerts tied to the account),
ADR 0061 (the owner's moderation tools) and ADR 0082 (game-night alerts).

## Context
- A signed-out fan on an iPhone's Safari (outside the Home Screen) had no way to follow a team: the program page said "This
  browser cannot show alerts" with no button, and a game page's "Follow these teams" block was empty. Since My teams lists only
  followed teams, it never appeared for them either. That is most phone visitors arriving from a shared link.
- The signed-out Follow button was alerts only: a fan who had since blocked notifications could not unfollow (the unfollow asked
  for permission first and failed), and a browser at its 25-team cap (push_subscription's check, migration 0008) heard "check
  your connection".
- `/admin/moderation` listed only reported and hidden posts. The owner's account has no fan profile, so it cannot report, and a
  post the owner saw that no fan reported could not be hidden.
- Several fan routes answered 503 with no log line, and a database error while the push sender deleted a gone browser stopped
  the whole run after its events were already claimed, so every browser after it lost that night's alerts.

## Decision
- **Follow without alerts.** Signed out on a browser without Web Push, the button is "Follow <school>" (the star, as signed in).
  The team is kept in this browser's own list (`localStorage`, the list My teams and the alerts already use) and nothing is
  sent anywhere. The page says alerts need the Home Screen app on an iPhone or iPad (whose storage is separate, so the fan
  follows again there) and, while fan accounts are on, offers sign-in to follow on every device. The same 25-team cap holds.
- **An unfollow never asks for permission.** It updates the subscription the browser already has, or only the list.
- **The cap says itself.** Past 25 teams on one browser: "This browser follows 25 teams, the most it can. Unfollow one first, or
  sign in to follow up to 100." Nothing is asked or sent.
- **Recent posts for the owner.** Migration 0032 adds `admin_recent_posts()`: the newest posts still showing from the last 7
  days (at most 100, banned authors left out), with author, place and report count, admin-only through `admin_guard()`,
  read-only. `/admin/moderation` lists them with Hide, Mute and Ban, the existing audited functions. Before the migration is on
  the database the page says it needs 0032 and works as before.
- **No silent failure.** Every fan route's database failure logs one line, `<area>: database call failed <function> <SQLSTATE>`
  (`lib/log-db.ts`), never a value, id, endpoint or email; a refusal the fan is told about (the cap, a name taken) is not
  logged. The push sender's cleanup queries never throw: a failure is counted with its code and the run exits 1 at the end.

## Consequences
- A followed team on a browser without Web Push gets no alerts until the fan follows from a browser that can show them (or signs
  in); the page says so before and after the tap.
- The owner reaches any post of the last 7 days; an older unreported post still needs a fan's report or a direct SQL call.
- The live database needs migration 0032 applied once (the master applies it after merge); until then the Recent posts section
  shows its "needs migration 0032" line and nothing else changes.
