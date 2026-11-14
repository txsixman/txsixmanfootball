# Legal checklist for the attorney review

Written Nov 10, 2026 from plan v1.1 section 11 and ADRs 0002, 0005, 0006 and 0007. Not legal advice: this is the list
to hand a Texas attorney. **Due:** attorney sign-off by gate G5, Aug 8, 2027. Re-check the SCOPE Act litigation
before the review (plan 11.1).

## Ask the attorney
| # | Question | Where it comes from | Our current answer |
|---|---|---|---|
| 1 | Is using facts (scores, alignments, champions) with citations enough? And what is the exposure from reading game results off MaxPreps team pages against its terms? | ADR 0002, ADR 0008, ADRs 0009 and 0010 | Facts only, each with a source. Game results come from MaxPreps schedule pages by robot (the owner accepted the terms risk, ADR 0008); never SixManFootball.com or CalPreps. Pages credit no source at all (ADRs 0009, 0010); is that a problem? |
| 2 | Is a weekly robot read of a league's own public alignment page acceptable? | ADR 0005 | As a visitor, robots.txt honored, never the data server |
| 3 | School logos from each school's own site: trademark risk and takedown process | ADR 0006 | Accepted risk; removed at once on request |
| 4 | Does the community layer put us under the SCOPE Act, and which duties apply after the Fifth Circuit ruling? | Plan 11.1 | Age registration, no targeted ads, minimum data for known minors |
| 5 | Is the Texas Data Privacy and Security Act small-business exemption good for us? | Plan 11.1 | Never sell personal data |
| 6 | Free pick 'em and bracket contests with prizes: official rules wording | Plan 11.4 | Free to enter, no purchase necessary, written rules |
| 7 | Contributor license for submitted scores, photos and posts | Plan 11.5 | In the terms of service |
| 8 | Brand: trademark and domain search for the chosen name | Plan 11.5, 13.1; v1.2-notes item 2 | `txsixmanfootball.com` stays parked until Decision 2 |

## Documents to have drafted before the review
- Terms of service, with the contributor license (item 7)
- Privacy policy (items 4, 5)
- Community guidelines and corrections policy (plan 12)
- Official contest rules (item 6)
- Takedown process for logos, player data (48 hours) and DMCA notices

## Filings and setup (the owner)
| Item | Cost | When |
|---|---|---|
| Texas LLC, certificate of formation | $300 state fee | Before sponsor money or prize contests (plan: by June 2027) |
| Separate bank account | | With the LLC |
| DMCA designated agent, U.S. Copyright Office | small online fee | Before user content goes live (Phase 4) |
| General and media liability insurance quote | | Before launch |
| USPTO trademark, if filed | $350 per class base | After the brand is chosen |

## Built into the product already (show the attorney)
- No birth dates, contact details, player rankings or precise location for minors; no direct messages (CLAUDE.md).
- No betting language: rating, projected margin and chance to win only (ADR 0045); no ads or affiliate links for betting.
- Only a confirmed final names a winner (ADR 0004).
- Row-level security on every table; `audit_log` append-only; score submissions never deleted.
- WCAG 2.1 AA checked by axe on every page test.
