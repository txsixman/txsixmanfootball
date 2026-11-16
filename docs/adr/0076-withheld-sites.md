# ADR 0076: A site that allowed pages contradict is withheld, and no robot read fills it

**Status:** Proposed Nov 16, 2026; accepted when its pull request is merged. It adds one exception to ADR 0041's
never-overwrite rule: a by-hand correction that keeps a game's site blank. ADR 0041 is not edited.

## Context
- The second source placed the 2026 UIL Division II area game Runge v Mount Calm (Nov 20) at "Panther Field, Mount Calm".
- Runge ISD's own calendar places the game in Bartlett. Mount Calm ISD's own calendar shows no home game that night.
  No allowed page names the Bartlett venue.
- A blank site is filled by the next robot read (ADR 0041: a fresh value fills a blank). So blanking the row by hand
  would last only until the next morning read.

## Decision
1. **`data/corrections/sites.csv`** lists withheld sites: date, home, away (as the facts file spells them, either way
   round), the page that contradicts the read site, the reason and the date of the correction. It is schema-checked
   (`WithheldSiteRow`, `check-data.mjs`).
2. **A withheld game keeps no site and no address.** `mergeKickoffs` writes them blank whatever is kept or read. Every
   robot write to the facts file goes through it, including Results watch's commit step (`--merge-details`). The
   game's kickoff merges as usual.
3. **The page shows the game as one with no site** ("Site not listed yet"). No page says why.
4. **The data check fails** if a withheld game's facts row names a site, so a by-hand row cannot slip past the list.
5. **Lifting it is by hand:** once an allowed page names the site, remove the row from `sites.csv` and add the site by
   hand (ADR 0064 item 2), with the page's address in the commit message.

## Consequences
- A site that two schools' own pages contradict no longer shows, and stays hidden through later reads.
- A withheld row must be removed by hand, or the game shows no site even after the source corrects itself.
