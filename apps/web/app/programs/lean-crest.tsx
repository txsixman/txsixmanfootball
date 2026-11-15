import type { Identity } from "@/lib/identity";
import { crestLogo, initials, logoCopy } from "./crest";

/** The 24px crest of `CrestSlot` (app/ui.tsx), in the least markup: its look is set once, by `.cs` in globals.css, and only
 * the school's own colors, or a wide logo's width, stay inline. A program page lists about 100 of these (every past game,
 * every opponent), and each one is sent twice, as HTML and again in the page data, so the saved bytes count. A change to
 * `Crest` at size 24 (crest.tsx) must be made in `.cs` as well. Always decorative: it sits beside the school's name. */
const SIZE = 24;

export function LeanCrest({ school, identity }: { school: string; identity: Identity }) {
  const logo = crestLogo(identity, 1.6);
  if (logo) {
    // The box is white unless the logo is a light mark, which sits on the school's own color (`.cs > span`).
    const { bg } = identity.theme;
    return (
      <span className="cs">
        <span style={{ width: SIZE * Math.max(1, logo.aspect), ...(logo.light && { background: bg }) }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- fixed-size logos, a copy sized for the crest (ADR 0022) */}
          <img src={logoCopy(logo, SIZE)} alt="" loading="lazy" />
        </span>
      </span>
    );
  }
  const { bg, fg, stripe } = identity.theme;
  return (
    <span className="cs">
      <span aria-hidden="true" style={{ background: bg, color: fg, ...(stripe && { boxShadow: `inset 0 -2px 0 ${stripe}` }) }}>
        {initials(school)}
      </span>
    </span>
  );
}
