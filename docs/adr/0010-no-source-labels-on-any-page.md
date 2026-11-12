# ADR 0010: No source labels on any page

**Status:** Accepted Nov 10, 2026 (the owner: "Remove all source labels").
Widens ADR 0009 from robot-read results to every page. Narrows ADR 0002's "cite secondary sources" and the on-page
citations of ADRs 0005 and 0006 to **the data only**.

## Decision
- No page names or links to where a fact came from: no league bracket label on hand-entered games, and no
  "Sources" links (alignment, colors, mascot, logo) on program pages.
- **The data keeps every source.** `source_url` on every game and alignment row, and the source fields in
  `data/seed/schools/identity.json`, stay as they are, so a correction or takedown request can still be traced
  (ADR 0006's remove-on-request and ADR 0008's stop-on-request rules are unchanged).
- Verification labels stay: Confirmed, Unconfirmed, Disputed (ADR 0004).
- The invented `/scores/sample` page keeps its report counts ("2 sources: reporter, coach"); they show how the
  verification design will work and name no real site.
- Page tests fail if "MaxPreps", "Sources" or a "bracket." label appears on `/scores`, `/ratings` or a program page.

## Consequences
- A reader cannot check a fact against its source on the page. A future corrections page can show sources on request.
- The attorney review (`docs/plan/legal-checklist.md`, item 1) covers showing facts without credit.
