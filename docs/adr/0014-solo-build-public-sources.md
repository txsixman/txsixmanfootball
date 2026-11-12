# ADR 0014: A solo build from public internet sources; no partnership, no outside people

**Status:** Accepted Nov 11, 2026 (the owner, answering `docs/plan/v1.2-notes.md` items 1, 2 and 4). Supersedes the
partnership path of plan v1.1 (sections 13.1, 14, 15.3, 17, 20) and ADR 0002's "attorney review before launch".
ADRs 0002, 0005, 0006 and 0008 to 0013 are otherwise unchanged.

## Context
Plan v1.1 assumed a team around the build: reporters and moderators on game nights, athletic directors, historians
invited from the incumbent site, an LLC, an attorney, sponsors, and a partnership talk with the incumbent site's
owner in June-July 2027. The v1.2 notes found three problems with that: the "quiet build" ships a public alpha and
invites the incumbent's people before the owner talk (item 1), the domain sits one prefix from the incumbent's
(item 2), and the 482 build hours left no time for any of the people work (item 4).

## Decision
- **The owner builds it alone.** No reporters, moderators, athletic directors, historians, LLC, attorney, sponsors or
  partnership pitch. Their hours leave the plan.
- **No talk with the incumbent site's owner**, before or after launch. The site is built on its own.
- **Data comes from public internet sources**, read under the rules already in force: league pages (ADR 0005), school
  sites for logos (ADR 0006), MaxPreps schedule pages for results (ADR 0008), and cited public records. Never
  SixManFootball.com, never CalPreps, never Dave Campbell's API. Scores are confirmed by agreeing sources (ADR 0011),
  not by people.
- **`txsixmanfootball.com` may be used publicly.** It is the site's address once the owner connects it. The site stays
  `noindex` until the owner says to open it.
- **The partnership hard lines stay** as rules of conduct (never read the incumbent's site, never poach its people,
  never use its name or marks).

## Consequences
- Phase 3's reporter app, moderator queues and SMS score entry are cut. Game-night scores come from the robot reads,
  with the admin console (Phase 1 item 6) to correct them.
- `docs/plan/legal-checklist.md` stays as a reference only; no attorney sign-off gate. The accepted risks are the owner's:
  MaxPreps terms (ADR 0008), school logos (ADR 0006), the domain's closeness to the incumbent's name.
- Minors' data rules stay: no accounts or personal data for minors, push alerts store no identity (migration 0008).
- Connecting the domain needs the owner: its DNS is on his Cloudflare account.
