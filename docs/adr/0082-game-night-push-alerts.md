# ADR 0082: Game-night push alerts (kickoff, final, next playoff game)

**Status:** Proposed Nov 16, 2026; accepted when its pull request is merged. It extends the push alerts of migration 0008 and
ADRs 0054 (alerts tied to the account) and 0058 (per-team mutes). Plan v1.2 section 5: Phase 3 game night runs on the robot
reads and push alerts.

## Context
- Finals alerts are live: the Follow button subscribes the browser (asking permission on the tap), Results watch's `alerts`
  job runs `tools/push/send-finals.mjs` after a commit of new results, and it sends one alert per browser for its programs'
  new finals. A browser that is signed in is linked to the account, so the account's follows drive it (ADR 0054).
- A game night has two more moments a follower wants: the kickoff, and (in the playoffs) who their team plays next. The
  night read already writes the games under way (`--live-out`, ADR 0021) every 10 minutes, and the next-round pairings are
  computed from the bracket files by `pagePairings` (`tools/league-watch/bracket-due.mjs`, ADR 0079).
- Finals were deduplicated only by the git diff (`--before HEAD~1`): a rerun of the job would alert again.
- There was no single place for a fan to turn alerts on or off for a device: only per team (the Follow button) or the
  Account Center's device list.

## Decision
- **Three alerts.** Kickoff ("Away v Home has started", when a game first appears in the live file and is not finished),
  final ("Final: Winner 48, Loser 12"), next playoff game ("Next round: Away v Home", the league, division and round in the
  body; the last round is always "State Championship"). Each opens the game's page (`/scores/<id>`, the bracket's order for a
  playoff game, as the pages are addressed). A kickoff and its final share a notification tag, so the final replaces the
  kickoff on the device. Kickoffs expire after 1 hour, the others after 6. Mutes, account follows, one alert per browser and
  the 404/410 deletion all work as before.
- **Pairings need no diff.** The sender takes the season's current `pagePairings`, drops those already played, and lets the
  sent-log say which are new. The first run after the switch is turned on therefore alerts each pairing already set and
  not yet played, once.
- **At most once.** A new table `push_sent` (migration 0031) holds one row per event key (`kickoff|…`, `final|…` with the
  score, `pairing|…`). The sender claims the key (`insert … on conflict do nothing returning`) before sending and skips an
  event already claimed. A run that fails after the claim does not resend: a missed alert is better than a repeated one on a
  game night. Rows older than 90 days are deleted by the sender. Row-level security with no policy and no grant: only the
  database owner (the sender) can read or write it. The dedupe applies to finals whatever the switch, which a fan cannot see.
- **Built dark, two switches, both off.** The database row `site_switch` `push_alerts` (the posts switch's table, ADR 0052,
  every change in `audit_log`) is what the sender reads: off, finals go out exactly as before and nothing else does. The
  Vercel variable `FAN_PUSH_ALERTS` (exactly `on`, server only, read at request time through `GET /api/push/status`) shows
  the alerts toggle. Off, the site looks as it did. Either can be undone on its own; the database one is instant.
- **One toggle a device.** "Game alerts on this device" on the home page's My teams block and on `/account`. Permission is
  asked only inside the tap. Signed in, on links this browser to the account (ADR 0054); off removes this device's
  subscription (the Account Center's own path). Signed out, on subscribes this browser for the teams it follows; off stops the
  subscription and keeps the followed list. iPhone and iPad Safari show alerts only for a site added to the Home Screen, so
  there the toggle is replaced by that one instruction; a blocked permission says where to undo it.
- **Signed-out follows keep their alerts.** They have had them since migration 0008, and it stays the simplest safe choice:
  the row holds only the push service's endpoint, its two public keys and program slugs, no account, name, IP address or
  user agent; knowing the endpoint (a long random URL only the browser and its push service hold) is the proof of owning it;
  and the table's caps and eviction (migrations 0008, 0018) bound what an anonymous caller can add.
- **No route can send.** Sending happens only in GitHub Actions (Results watch: the `alerts` job after a results commit, and
  a "Kickoff alerts" step after each night read's live scores), with the `VAPID_PRIVATE_KEY` and database secrets. The site
  holds no private key and has no send endpoint, so nobody can trigger an alert over HTTP. The site's push routes stay as
  they were (same-site, session where they need one); the new status route reads one variable and touches no data.
- **The keys are the ones already in use.** The VAPID pair was made by `tools/push/setup-vapid.mjs` on Nov 12: the private
  half is in the owner's Keychain and the repo secret, never on screen or on disk; the public half is committed. Vercel needs
  neither, because the site never sends. Rotating is `node tools/push/setup-vapid.mjs --rotate` (every browser must then
  turn alerts on again).

## Consequences
- The kickoff step runs inside the night read's job with `continue-on-error`, so a push failure never holds back a final.
- A pairing the bracket sets but no listing has yet links to the bracket-set game page (ADR 0079), which exists for it.
- A game the reader first sees already finished gets no kickoff alert, only its final.
- An event is claimed only when at least one browser would receive it (after mutes and the push-host check), so a fan who
  follows a team after its pairing was set still gets that pairing alert while the game is ahead.
- Switch off, finals keep the one-message-per-browser summary ("N new finals"); switch on, each event is its own notification
  with its own tag and lifetime.
- Pairings come from `pagePairings` (loaded on demand by the sender); if that fails the run warns, sends no pairings and
  never holds back a final. Pairing alerts cover only rounds fed by winners; round labels follow the site's
  (`lib/brackets.ts`), and the last round (`final`, `state`) always reads "State Championship".
- More alerts per night: a fan following one team gets at most three per game; per-team mutes (ADR 0058) and the device
  toggle are the way to fewer.
