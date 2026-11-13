import { Crest } from "@/app/programs/crest";
import type { Identity } from "@/lib/identity"; // the type only: lib/identity.ts reads files, which a story cannot

// A program's crest for each kind of logo. The schools are invented and the marks are drawn here: never a real school's
// logo (ADR 0006).
export default { title: "Crest" };

const mark = (width: number, fill: string, text: string) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 100"><rect x="4" y="4" width="${width - 8}" height="92" rx="14" fill="none" stroke="${fill}" stroke-width="8"/><text x="${width / 2}" y="66" font-family="sans-serif" font-size="48" font-weight="700" text-anchor="middle" fill="${fill}">${text}</text></svg>`,
  )}`;

const school = (logo: Identity["logo"], theme = { bg: "#7a1f2b", fg: "#ffffff", stripe: null }): Identity => ({
  mascot: "Rams",
  colors: [],
  logo,
  theme,
});

const Row = ({ identity, maxAspect }: { identity: Identity; maxAspect?: number }) => (
  <div className="flex items-end gap-6">
    {[24, 48, 72].map((size) => (
      <Crest key={size} school="Cedar Gap" identity={identity} size={size} maxAspect={maxAspect} />
    ))}
  </div>
);

export const MissingLogo = () => <Row identity={school(null)} />;
export const DarkLogo = () => <Row identity={school({ src: mark(100, "#7a1f2b", "CG"), small: mark(100, "#7a1f2b", "CG"), tiny: mark(100, "#7a1f2b", "CG"), large: mark(100, "#7a1f2b", "CG"), aspect: 1, light: false })} />;
export const LightLogo = () => <Row identity={school({ src: mark(100, "#ffffff", "CG"), small: mark(100, "#ffffff", "CG"), tiny: mark(100, "#ffffff", "CG"), large: mark(100, "#ffffff", "CG"), aspect: 1, light: true })} />;
export const WideLogo = () => (
  <Row identity={school({ src: mark(380, "#7a1f2b", "CEDAR GAP"), small: mark(380, "#7a1f2b", "CEDAR GAP"), tiny: mark(380, "#7a1f2b", "CEDAR GAP"), large: mark(380, "#7a1f2b", "CEDAR GAP"), aspect: 3.8, light: false })} maxAspect={4.8} />
);
export const TooWideLogo = () => <Row identity={school({ src: mark(380, "#7a1f2b", "CEDAR GAP"), small: mark(380, "#7a1f2b", "CEDAR GAP"), tiny: mark(380, "#7a1f2b", "CEDAR GAP"), large: mark(380, "#7a1f2b", "CEDAR GAP"), aspect: 3.8, light: false })} />;
