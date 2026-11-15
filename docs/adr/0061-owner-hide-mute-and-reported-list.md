# ADR 0061: The owner can hide and mute by hand, and sees every reported post

**Status:** Proposed Nov 15, 2026; accepted when its pull request is merged. It extends ADR 0018's "the owner may unhide,
unmute or ban" and keeps "nothing waits on him".

## Context
`/admin/moderation` listed only posts already hidden by flags, and muted or banned accounts. The owner could show a post again,
lift a mute, or ban. He could not hide one post that the word list missed without banning its author, could not give a short
time-out, and never saw a post with one or two reports, or reports from accounts too new to count. The launch list asks for a
moderation queue with hide, unhide, mute and ban, each with an audit trail.

## Decision
- **Reported posts.** The page's first list is every post reported at least once and not hidden, most reports first, with its
  text, its author, how many reports and how many of those count toward hiding (accounts older than 7 days, not muted or
  banned). Never who reported. A post the owner showed again leaves the list until someone reports it after that.
- **Hide** (`admin_hide_post`): hides one post now. It counts toward its author's automatic mute like a post that reports hid.
  "Show again" (`admin_unhide_post`, unchanged) undoes it and clears the post.
- **Mute** (`admin_mute`): mutes an account for 1, 3, 7, 30 or 90 days from now (the database accepts 1 to 90). A longer mute
  already set is kept. "Lift mute" and Ban are unchanged.
- **Every one writes `audit_log`** with the owner's id, the post or account id, the state before and after, and the reason he
  typed (required, 3 to 200 characters). Never the post's text. Each function checks `is_admin()` itself; the page calls them
  with his own session, never a service key.
- **Still no queue to clear.** Reports still hide a post on their own at three that count, and the list is there for the owner
  when he looks. Nothing waits on him.

## Consequences
- The owner now sees reports that do not count. Those are where a new account's report, or a pile-on by new accounts, shows up.
- `/admin/moderation` stays open while posts are off (ADR 0052), so he can still hide, mute and ban after closing posts.
