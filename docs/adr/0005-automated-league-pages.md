# ADR 0005: Read a league's own public alignment page by robot

**Status:** Accepted Nov 10, 2026 (the owner chose this over asking TAPPS first). Adds to ADR 0002; does not replace it.

## Context
TAPPS publishes its 2026-28 six-man alignment only in a widget on its public alignment page. Its PDFs give team
counts, not schools. TAPPS posts no terms of use (the footer links lead nowhere), and `tapps.biz/robots.txt` allows
every crawler. The owner wants league alignments to stay current without anyone reading pages by hand.

## Decision
A scheduled job may read a league's **own** public alignment page, under these rules:
- It loads the page in a headless browser and uses the page's own controls, as a visitor would. It never calls the
  league's data server directly.
- It names itself in the user agent (`Project80x40-alignment-reader`), runs at most weekly, and stops if
  `robots.txt` disallows the page.
- Nothing behind a login, and nothing from a site that is not the league itself.
- A read that fails its plausibility checks fails the job. Nothing is written.
- A change lands only through a pull request that a person checks against the page before merging.
- If the league objects, the job stops and we ask the league for the data instead.

First user: TAPPS (`tools/league-watch/tapps.mjs`, `.github/workflows/league-watch.yml`).

## Consequences
- TAPPS updates arrive as a pull request within a week, with no hand reading.
- The reader breaks when TAPPS redesigns the widget. The checks turn that into a failed job, not bad data.
- TAPPS marks some schools with `*` and never says why. The names are kept in `data/seed/tapps-2026-28/marked.txt`
  until someone finds out.
- Asking TAPPS for a feed or file is still the better long-term route, and the relationship it would start matters
  for the partnership plan.
