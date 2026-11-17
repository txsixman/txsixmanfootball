// The site's mark (app icon, home share card), drawn at build time: "TX6" in white on navy over a red bar. The
// codename "80x40" (the six-man field) stays out of sight (the owner, Nov 11, 2026: visitors see TX Six-Man Football).
/** `inset`: a share of the size kept clear on every side, for a maskable icon (a phone crops its edge to a circle or rounded square). */
export function Mark({ size, inset = 0 }: { size: number; inset?: number }) {
  const pad = size * inset;
  return (
    <div style={{ width: size, height: size, display: "flex", flexDirection: "column", background: "#0a2a5e", paddingTop: pad, paddingLeft: pad, paddingRight: pad }}>
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#ffffff", fontSize: size * (inset ? 0.26 : 0.3), fontWeight: 900, letterSpacing: -size * 0.01 }}>
        TX6
      </div>
      <div style={{ height: size * 0.12, background: "#bf1e2e", marginBottom: pad ? pad * 0.4 : 0 }} />
    </div>
  );
}

/** The site's display face for drawn images (next/og reads .woff, not .woff2). */
export async function brandFont() {
  const { readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const data = await readFile(join(process.cwd(), "node_modules/@fontsource/barlow-condensed/files/barlow-condensed-latin-700-normal.woff"));
  return [{ name: "Barlow Condensed", data, weight: 700 as const, style: "normal" as const }];
}
