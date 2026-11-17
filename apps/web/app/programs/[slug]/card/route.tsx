import { ImageResponse } from "next/og";
import { loadAlignments, uniquePrograms } from "@/lib/alignments";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { brandFont } from "../../../mark";
import { cardSize } from "../../../page-card";
import { logoOf } from "../../../share-card";
import { programCardOf } from "./program-card";

// The card a link preview shows when a program page is shared (/programs/<slug>/card, the page's og:image): the school's logo as
// published (ADR 0006, ADR 0016; its initials in its colors when it has none), its name and place, this season's rank and record
// and its latest score (lib/share-text.ts, ADR 0093), in the school's colors. A plain route, as the game card is, so each card can
// carry alt text of its own. Drawn at build time, so it shows the last deploy's data, never a score being played.
export const dynamicParams = false;
export const generateStaticParams = async () => uniquePrograms(await loadAlignments()).map((a) => ({ slug: a.slug }));

const TILE = 340;
/** The school's name steps down with its length: it shares the line with the logo, and may wrap to two. */
const nameSize = (name: string) => (name.length <= 12 ? 112 : name.length <= 18 ? 88 : name.length <= 26 ? 68 : 56);

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { school, identity, text, initials } = await programCardOf(slug);
  const { theme } = identity;
  const logo = await logoOf(identity);
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", fontFamily: "Barlow Condensed", background: theme.bg, color: theme.fg }}>
        <div style={{ flex: 1, display: "flex", alignItems: "center", padding: "0 72px", gap: 48 }}>
          {logo ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: TILE, height: TILE, padding: 20, background: logo.bg, border: `6px solid ${theme.fg}` }}>
              {/* eslint-disable-next-line @next/next/no-img-element -- drawn into the image at build time, as published (ADR 0006) */}
              <img src={logo.uri} alt="" width={TILE - 52} height={TILE - 52} style={{ objectFit: "contain" }} />
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: TILE, height: TILE, border: `6px solid ${theme.fg}`, fontSize: 150, fontWeight: 700 }}>{initials}</div>
          )}
          <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: 32, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", opacity: 0.9 }}>{text.kicker}</div>
            <div style={{ display: "flex", fontSize: nameSize(school.school), fontWeight: 900, lineHeight: 1, marginTop: 10, textTransform: "uppercase" }}>{school.school}</div>
            {identity.mascot && <div style={{ display: "flex", fontSize: 44, fontWeight: 700, marginTop: 10, textTransform: "uppercase" }}>{identity.mascot}</div>}
            {text.standing && <div style={{ display: "flex", fontSize: 48, fontWeight: 700, marginTop: 24 }}>{text.standing}</div>}
            {text.latest && <div style={{ display: "flex", fontSize: 42, fontWeight: 700, marginTop: 10, opacity: 0.95 }}>{text.latest}</div>}
          </div>
        </div>
        <div style={{ height: 96, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 72px", background: "#0a2a5e", color: "#ffffff", borderTop: `10px solid ${theme.stripe ?? "#bf1e2e"}` }}>
          <div style={{ display: "flex", fontSize: 40, fontWeight: 900 }}>{SITE_NAME}</div>
          <div style={{ display: "flex", fontSize: 30 }}>{SITE_URL.replace("https://", "")}</div>
        </div>
      </div>
    ),
    { ...cardSize, fonts: await brandFont() },
  );
}
