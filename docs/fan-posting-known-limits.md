# Fan posting: known limits

Accepted on purpose (ADR 0018 stays as written). Both are about what a small group of real, patient accounts can do. The
rules in the database (migrations 0013 to 0015) stop everything below that. If either one starts happening, the fix is a
new ADR, not an edit to 0018.

## One person, two accounts, one confirmed score

A fan score is confirmed when two different accounts, each older than 7 days when they reported, give the same score.
One person who signs up twice (for example with `name+1@example.com` and `name+2@example.com`, which most mail
providers deliver to one inbox) and waits 7 days can confirm any score for a game that has none yet.

- Cost to the person: 2 sign-ups, a 7 day wait, and per account at most 5 reports in 10 minutes and 30 a day (so up to 30
  games a day for the pair).
- What it buys: a score shown on a game page, with no winner named (ADR 0004), until the Results watch reads the real
  final. The Results watch's score always wins; reports that differ from it show nothing.
- How it is limited today: one report per account per game; a banned account's reports stop counting at once (and count
  again if the ban is lifted); reports open only 2 hours after kickoff (6 PM Central on game day when no kickoff is
  listed); the owner can ban an account from the console.
- Not fixed because: telling two inboxes from one person needs an identity check the site does not collect (no real
  names, no phone numbers, ADR 0018).

## Three established accounts can hide a post

A post is hidden when 3 different accounts, each older than 7 days and not muted or banned, flag it. Three accounts that
agree to can hide any fan's post, whatever it says.

- Cost to them: 3 accounts older than 7 days; each may flag 10 posts in 10 minutes and 100 a day, so the group can hide
  up to 100 posts a day.
- Knock-on: 3 hidden posts in 30 days mute the author for 7 days, so the group can mute a chosen fan with 3 posts' worth of flags.
- How it is limited today: a hidden post is kept, not deleted; the owner can restore it and mark it fine (the post is
  then never hidden again until its author edits it), unmute the author, and ban the flaggers, whose flags stop counting
  at once. New accounts' flags are recorded but never counted.
- Not fixed because: raising the number of flaggers makes it easy for genuinely abusive posts to stay up; 3 is the
  balance the owner chose for a site with one moderator.
