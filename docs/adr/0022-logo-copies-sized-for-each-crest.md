# ADR 0022: Each crest is drawn from a WebP copy sized for it

**Status:** Proposed Nov 13, 2026, for page weight on phones; accepted when its pull request is merged. Replaces ADR
0016's line "lists use a copy that fits 288x96 in `small/`". Every other rule of ADRs 0006 and 0016 stands: the untouched
original is kept, the stored file is the edited logo, and every edit is written down.

## Context
A phone measurement of production (390px wide, 3x screen) found the logos were the largest part of `/scores` (244 KB of
689 KB) and a large part of the home page (107 KB). Every list crest is 24px high, a 20px mark on a 3x screen, 60
pixels, but each was drawn from the 96px-high `small/` copy, about 2.6 times the pixels it needed. The program page's
header crest (72px high at most, 180 pixels on a 3x screen) was drawn from the stored file, up to 320 pixels high. A
link to a program page also preloads that header logo whenever the page is prefetched, so game pages paid for two
stored files they never showed.

## Decision
- **Three copies of every raster logo, made from the stored file by `tools/school-identity/fetch-logos.mjs`, each sized
  for a 3x screen:** `tiny/` fits 192x64 (crests 24px high or less, most lists), `small/` fits 288x96 (25 to 48px) and
  `large/` fits 780x180 (the program page header, up to 72px high and 260px wide). `app/programs/crest.tsx` picks the
  copy by the crest's size. An SVG logo is drawn as itself at every size.
- **Each copy is WebP, lossless, of a palette image:** shrunk into its box with its colors reduced to a palette, as the
  stored PNG's already are, then saved as lossless WebP. Every visible pixel is the palette PNG's; only the color of a
  fully clear pixel may change, and it is never seen. The `small/` copies are the same pixels as the PNGs they replace,
  about 12% smaller. Lossy WebP and AVIF were measured and not used: they are not the same pixels.
- **The stored PNG stays** in `apps/web/public/logos/` as ADR 0016's edited logo, the file the copies, the audit, and
  `aspect` and `light` are made from. The site no longer draws it.
- `tools/school-identity/identity.test.mjs` checks that every raster logo has all three copies;
  `apps/web/scripts/logo-files.test.mjs` checks a copy is WebP, fits its box, is never enlarged and has the palette
  image's visible pixels.

## Consequences
- Measured against the new files, the logos a phone downloads drop by about 105 KB on `/scores`, 46 KB on the home page,
  25 KB on a program page and 16 KB on a game page.
- The repo holds about 5.5 MB of copies in place of 1.7 MB (`tiny/` 0.9 MB, `small/` 1.5 MB, `large/` 3.1 MB).
- A new or rebuilt logo gets its three copies from the same run of `fetch-logos.mjs`; a run with no flags also makes any
  copy that is missing.
- WebP is drawn by every browser the site supports (Safari 14 and later), so there is no PNG fallback.
