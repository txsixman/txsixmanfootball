# ADR 0006: School logos from each school's own site; colors and mascots as cited facts

**Status:** Accepted Nov 10, 2026. The owner chose real logos now over waiting for each school's permission, knowing a
logo is a trademark and that ADR 0002 asks for permission first. This ADR is the recorded exception.

## Decision
- **Colors and mascots** are facts. Each is stored with the URL it came from (`data/seed/schools/identity.json`).
  Color names map to hex values in one reviewed table in code; an unknown name fails the tests instead of guessing.
- **Logos** come only from the school's or its district's own official website: never MaxPreps, Hudl,
  SixManFootball.com, Wikipedia, image search or fan sites. Each logo keeps the page it was found on, the image URL
  and the date fetched. The page must be on the school's own domain; the image may be served by the website platform
  that hosts that page (ParentSquare, Finalsite, Apptegy and the like, listed in `CMS_HOSTS`).
- A school site that uses a professional team's mark as its own (an NFL logo, for example) gets the badge instead.
- **Wikipedia** may be the source of a color or mascot fact (text only, cited), read from the article's infobox through
  the public MediaWiki API at one request a second. Its images are never used.
- A logo is shown only to identify its school: on its program page and next to its name. It is never altered,
  recolored, cropped into new artwork, sold, or used in ads or merchandise.
- **Removal on request:** a school that asks gets its logo removed and listed in `removed`, which the fetcher and the
  site both honour. The fallback is a badge in the school's colors.
- **Safety:** the fetcher accepts only PNG, JPEG, GIF, WebP or SVG downloads under 5 MB whose bytes match their type,
  refuses SVGs with scripts, event handlers or embedded content, stores rasters shrunk to 320px, and the site serves
  `/logos/` with a locked-down Content-Security-Policy.

## Consequences
- School pages look like the school from day one.
- Trademark risk is accepted by the owner. Many small-school logos copy college or pro marks; those are the most likely
  to draw a takedown. The attorney review before launch (ADR 0002) must cover logos.
- A school's page can still claim its own logo later, which turns this exception into permission.
