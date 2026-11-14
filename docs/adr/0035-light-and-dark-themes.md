# ADR 0035: Light and dark themes from one set of color tokens

**Status:** Proposed Nov 13, 2026; accepted when its pull request is merged. Pages audit item E.

## Context
The site had one light palette (red, white and blue, Nov 10). Many fans check scores at night on a phone set to dark mode.
Colors were already theme tokens (`page`, `panel`, `line`, `navy`, `red`, `ink`, `muted`), with three exceptions:
`bg-white` surfaces, and `bg-navy` and `bg-red` bands under white text. In a dark theme `navy` and `red` must turn light
to read as text on a dark page, so a band filled with them would put white text on a light color.

## Decision
- **Each token is `light-dark(light, dark)`** in `app/globals.css`. The page follows the system setting (`color-scheme:
  light dark`).
- **The footer's choice** (System, Light, Dark; `app/theme-toggle.tsx`) sets `data-theme` on `<html>`, which pins
  `color-scheme`. Light or Dark is kept in this browser's `localStorage` (`theme`); System removes it. A small script in
  the page's `<head>` applies a kept choice before the first paint, so a page never flashes the wrong theme.
- **Two fill tokens** carry white text: `band` (header, footer, section heads, the current tab) and `alert` (live and
  tonight). They stay dark in both themes. A light surface is `bg-page` or `bg-panel`.
- **Every text pair passes WCAG AA in both themes.** Dark values: page `#0d1526`, panel `#17223a`, line `#34456b`, ink
  `#e8edf7`, muted `#a9b4ca`, navy `#a9c4ff`, red `#ff8089`, band `#1c3a72`, alert `#b51f2c`. The lowest pair is the
  current section's red underline on the band (4.6 to 1).
- **Drawn images stay light:** share cards, icons and the game card are rendered once.
- **The embed is unchanged:** `/embed/...` keeps its own `?theme=` (light, dark or auto).
- A school's own colors still carry the program page's header. Its rank line uses the school's color only where it
  stands out on both pages, otherwise the theme's navy.

## Consequences
- `scripts/theme-tokens.test.mjs` refuses a color class that ignores the theme (`bg-white`, `bg-navy`, `bg-red`,
  `bg-ink`, `text-black`, or a fixed hex) in `app/` and `components/`.
- `e2e/theme.spec.ts` runs axe's color-contrast rule on one page of each kind in both themes, and checks that the
  choice is followed and kept.
- `e2e/screenshots.spec.ts` keeps a dark baseline beside each light one.
