import { readFile } from "node:fs/promises";
import path from "node:path";
import { memo } from "./memo";
import { ColorsFile, IdentityFile, parseJson } from "./data-schemas";

// School colors, mascots and logos (ADR 0006), read at build time from data/seed/schools.
type Raw = {
  school: string;
  site: string | null;
  mascot: string | null;
  mascotSource: string | null;
  colors: string[];
  colorsSource: string | null;
  logo: { image: string; page: string; file?: string; aspect?: number; light?: boolean; tile?: "dark" | "white"; retrievedOn?: string } | null;
};

type Theme = { bg: string; fg: string; stripe: string | null };
/** No source URL lives here: this object reaches client components, and no page names or links a source (ADR 0010).
 * The sources stay in data/seed/schools/identity.json. */
export type Identity = {
  mascot: string | null;
  colors: { name: string; hex: string }[];
  /** aspect is width over height; wide wordmarks need a wider box. light: a white mark that needs a dark tile (the measured `light`, unless the data says `tile`).
   * `small`: a copy fitting 288x96 (twice a 48px crest's height up to aspect 3) for crests drawn at 48px or less (the SVG itself when the logo is an SVG). */
  logo: { src: string; small: string; aspect: number; light: boolean } | null;
  theme: Theme;
};

const SEED = path.join(process.cwd(), "../../data/seed/schools");
const DEFAULT: Theme = { bg: "#0a2a5e", fg: "#ffffff", stripe: "#bf1e2e" };

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/** The first solid (not near-white) school color fills the band; text is white or near-black, whichever reads at 4.5:1 or better. */
function themeFor(hexes: string[]): Theme {
  const solid = hexes.filter((h) => luminance(h) < 0.7);
  if (!solid.length) return DEFAULT;
  const bg = solid[0];
  const fg = contrast(bg, "#ffffff") >= 4.5 ? "#ffffff" : "#111111";
  if (contrast(bg, fg) < 4.5) return DEFAULT;
  const stripe = hexes.find((h) => h !== bg && contrast(h, bg) >= 1.5) ?? null;
  return { bg, fg, stripe };
}

/** Shared across pages: never mutate it. */
export const loadIdentities = memo<void, Map<string, Identity>>(async () => {
  const [identity, table] = await Promise.all([
    readFile(path.join(SEED, "identity.json"), "utf8").then(
      (json) => parseJson("data/seed/schools/identity.json", json, IdentityFile),
      (e: NodeJS.ErrnoException) => {
        if (e.code === "ENOENT") return { removed: [], schools: {} };
        throw e;
      },
    ),
    readFile(path.join(SEED, "colors.json"), "utf8").then((json) => parseJson("data/seed/schools/colors.json", json, ColorsFile)),
  ]);
  const removed = new Set<string>(identity.removed);
  const map = new Map<string, Identity>();
  for (const [slug, s] of Object.entries(identity.schools as Record<string, Raw>)) {
    const colors = s.colors.map((name) => {
      const hex = table[name];
      if (!hex) throw new Error(`${slug}: color "${name}" is not in colors.json`);
      return { name, hex };
    });
    map.set(slug, {
      mascot: s.mascot,
      colors,
      logo: s.logo?.file && !removed.has(slug) ? { src: `/logos/${s.logo.file}`, small: s.logo.file.endsWith(".png") ? `/logos/small/${s.logo.file}` : `/logos/${s.logo.file}`, aspect: s.logo.aspect ?? 1, light: s.logo.tile ? s.logo.tile === "dark" : Boolean(s.logo.light) }
          : null,
      theme: themeFor(colors.map((c) => c.hex)),
    });
  }
  return map;
});

export const EMPTY: Identity = { mascot: null, colors: [], logo: null, theme: DEFAULT };
