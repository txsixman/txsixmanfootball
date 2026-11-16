# ADR 0073: The program registry counts what it is missing as "not yet listed"

**Status:** Proposed Nov 15, 2026; accepted when its pull request is merged. It builds on ADR 0002 (permission-first
data), ADR 0005 (league pages read as a visitor), ADR 0012 (organizations stay separate) and ADR 0014 (public pages only,
no outreach), and closes Phase 1 backlog item 2 under its cut rule.

## Context
- Gate G2 (Feb 14, 2027) needs 100% of current six-man programs registered: a row with a league and a source each.
- The registry is the alignment files: UIL (157, UIL's own two 2026-28 six-man PDFs, checked name for name on Nov 15),
  TAPPS (68) and TAIAO (46) by their robots, TCAF (9) and Independent (1) by hand. Every row already had a source, and
  every team in a 2026 game already resolved to a program (the unknown-team check).
- What was missing were whole leagues and a few teams no public page places:
  - **TCAL** runs six-man: its own football plan sets six-man Divisions I and II and their rules. But its own pages
    publish no 2026 six-man teams, schedule, standings or alignment (its six-man page is an unfilled template; its
    general classification list is not by sport). The only 2026 lists found are a fan newsletter citing a social post
    and a TV station whose robots.txt disallows Claude, neither usable.
  - **TCSAAL** plays no six-man: its own 2026-27 football page lists 11-man tackle only.
  - **Outside opponents**: 2026 games of listed programs against 17 Texas teams no alignment held (the results robot's
    coverage file). Read from their own sites, UIL's 2026-28 list and local news (Nov 15, 2026): two state six-man on
    their own sites (CHANT, "a six-man Football program"; The Covenant Preparatory School, a 6-Man schedule and roster)
    and name no league for football; four are 11-man (Abilene Texas Leadership and Memphis by UIL's list; Sacred Heart
    and Bishop Gorman play TAPPS Division IV; TAPPS six-man stops at Division III); High Island is six-man Division II on UIL's list but in
    no district on UIL's revised Division II alignment; ten others no allowed page places at all.
- The backlog's cut rule: if TCSAAL or independents cannot be sourced, mark them "not yet listed", counted and shown on
  the programs index, rather than guessed.

## Decision
1. **Register what a public page states.** CHANT and Covenant Prep join Independent (the schools' own sites; Independent is
   the organization for a six-man program whose own site names no league, DECISIONS Nov 11), with their results-robot aliases, so their games are read
   from the next run. Nothing else is added: a team's six-man games alone do not say which league, if any, it plays in.
2. **One file says what is missing:** `data/seed/private-2026/not-listed.csv` (`league,school,reason,checked_on,
   source_url`), by hand. A row with no school is a league with no public six-man list; a row with a school is a team
   that plays six-man teams but that no public page places, under its league if one is known, else "League not
   known". `source_url` is the page that was checked, kept in the data and never shown (ADR 0010).
3. **Shown, never ranked.** `/programs` ends with a "Not yet listed" block: each league, the reason, and its teams, as
   plain text. A team in it has no program page, no rankings row and no organization tab; nothing is guessed into an
   alignment.
4. **A league gets an organization only with a public list.** TCAL and TCSAAL get no `ORGS` row, tab or filter now:
   neither has a 2026 alignment we can cite. When TCAL publishes one, its rows go in `private-2026/alignments.csv` (by
   hand, or a robot under ADR 0005 if it is a page) and it joins `ORGS` the way TAIAO and TCAF did.
5. **The check (Gate G2):** `check-data.mjs` `checkRegistry` fails when a school is listed twice in one league, when a
   not-yet-listed team is also a program, or when a league with programs also has a "no list" row. Each alignment row's
   league and source are the schema's; every 2026 game team being a program stays the unknown-team check.
6. **Re-check each season** (`checked_on`): a league page that starts listing six-man teams moves its rows into the
   alignments and out of this file.

## Consequences
- G2 reads as: every program a public page lists is registered with a source; what no page lists is counted in the open.
- Results against not-yet-listed teams stay out of the season files (the robot keeps skipping them), as before.
- TCAL's six-man teams stay off the site until TCAL, a school's own site or another permitted page names them.
