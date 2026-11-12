# ADR 0016: School logos may be edited to look right, and Dave Campbell's is an allowed logo source

**Status:** Accepted Nov 11, 2026 (the owner). Supersedes ADR 0006's "never altered, recolored, cropped" line and its
"only the school's or district's own site" source rule. ADR 0006 is otherwise unchanged (colors and mascots as cited
facts, removal on request, safe downloads, the accepted trademark risk).

## Context
An audit of the 251 stored logos found a blank image, grey boxes, opaque white boxes around marks, marks filling a
tenth of their canvas, about 40 logos under 160 pixels, and wide wordmarks shrunk to 60 pixels tall. ADR 0006 forbade
touching a logo, so none of this could be fixed, and 28 schools had no logo because their own sites blocked a robot,
shared only a thumbnail, or showed a professional team's mark.

## Decision
- **A stored logo may be edited in any way that makes it look right:** trim padding, strip a solid background, crop a
  mark out of a banner, recolor, upscale, or redraw from a clean source. It is still shown only to identify its
  school, never sold or used in ads or merchandise.
- **Sources:** the school's or its district's own site (and the website platform behind it, `CMS_HOSTS`), first; then
  **Dave Campbell's Texas Football** (`texasfootball.com`, now `davecampbells.com`): its team pages
  (`/team/<slug>`) and its image host (`images.davecampbells.com`), **logo images only**, never its polls, rankings,
  scores, stories or API. The page URL is the logo's `page`, the image URL its `image`.
- **Still banned:** MaxPreps, Hudl, Wikipedia and Wikimedia images, fan sites, SixManFootball.com (never read),
  CalPreps. A school's mark that copies a professional or college team's (Hart, Roby, Johnson County SA, Turkey Valley,
  Fort Bend Chargers) is used when that is what the school itself shows. The owner kept all three pro-style marks the
  audit raised (Turkey Valley's copy of the New England Patriots mark, Roby's and Johnson County SA's Dave Campbell's
  versions) as his accepted trademark risk (Nov 11, 2026).
- **Robots.txt is obeyed for every host a logo is downloaded from**, the image host included, one request at a time,
  with a plain user agent. A host that disallows robots (ParentSquare's file host does, for everything except
  Googlebot-Image) is not fetched again; its earlier download stands.
- **Removal on request** stays: `removed` in `identity.json`, honoured by the fetcher (which also deletes the original)
  and the site.
- **Every logo keeps its source URL**, the page it was found on and the date fetched.
- **Every stored logo keeps its untouched original**, byte for byte, in `data/seed/schools/logo-originals/<slug>.<ext>`
  (outside `apps/web/public`, so never served). `sha256` in `identity.json` is the original's hash. Where a host's
  robots.txt blocked a new download, the original is the 320-pixel copy stored from the earlier download, and the
  school's `notes` say so.
- **Every edit is written down.** A logo whose stored file is more than a plain shrink of its original has an `edit`
  note in `identity.json` saying what was done (stripped background, trimmed padding, hand crop). A hand crop is
  repeatable: `crop` (pixels of the original) is applied by the fetcher; `keepBackground: true` stops the automatic
  background strip. `node apps/web/scripts/check-data.mjs` and the tests check the note, the original and its hash.
- **Raster logos are stored to fit 1200x320** (was 320x320), so a wide wordmark keeps at least 160 pixels of height
  where its source allows; lists use a copy that fits 288x96 in `small/`. `aspect` and `light` are measured on the
  stored file. `light` marks a logo that would vanish on the white tile (most of it washed out against white and little
  of it strong).

## Consequences
- The site can show every logo at a usable size, and a bad file is fixed by an edit instead of by hunting for a
  different source.
- Dave Campbell's images are a second kind of dependency: a logo it hosts can change under us, so the original is kept.
- A school that copies a professional team's mark shows it; ADR 0006's trademark risk, accepted by the owner, now includes
  edited copies. The attorney review the project dropped (ADR 0014) would have covered this; it is the owner's risk.
- Schools with no logo from an allowed source keep the initials badge in their colors, and their `notes` say why
  (the owner, Nov 11, 2026).
