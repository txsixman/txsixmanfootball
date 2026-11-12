// The site's mark, drawn as an image at build time: "80x40" (the six-man field) in white on navy over a red bar.
export function Mark({ size }: { size: number }) {
  return (
    <div style={{ width: size, height: size, display: "flex", flexDirection: "column", background: "#0a2a5e" }}>
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#ffffff", fontSize: size * 0.3, fontWeight: 900, letterSpacing: -size * 0.01 }}>
        80x40
      </div>
      <div style={{ height: size * 0.12, background: "#bf1e2e" }} />
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
