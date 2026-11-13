import { ImageResponse } from "next/og";
import { heading, loadAlignments, placeLabel, uniquePrograms } from "@/lib/alignments";
import { EMPTY, loadIdentities } from "@/lib/identity";
import { loadRanked, rankLabel } from "@/lib/rankings";
import { record } from "@/lib/ratings";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { brandFont } from "../../mark";

// The card a link preview shows when a program page is shared: the school's colors, name, place and ranking. Drawn at
// build time from the same facts as the page. No logo: a school's logo is shown as published, never redrawn (ADR 0006).
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Program card";
export const dynamicParams = false;
export const generateStaticParams = async () => uniquePrograms(await loadAlignments()).map((a) => ({ slug: a.slug }));

export default async function Card({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [all, identities, ranked] = await Promise.all([loadAlignments(), loadIdentities(), loadRanked()]);
  const school = all.find((a) => a.slug === slug)!;
  const { theme, mascot } = identities.get(slug) ?? EMPTY;
  const r = ranked.teams.find((t) => t.school.slug === slug);
  const rank = r && `${rankLabel(r).text} · ${record(r)}`;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", fontFamily: "Barlow Condensed", background: theme.bg, color: theme.fg }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 72px" }}>
          <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: 3, textTransform: "uppercase", opacity: 0.9 }}>
            {`${heading(school)} · ${placeLabel(school)}`}
          </div>
          <div style={{ fontSize: school.school.length > 22 ? 84 : 112, fontWeight: 900, lineHeight: 1, marginTop: 12, textTransform: "uppercase" }}>
            {school.school}
          </div>
          {mascot && <div style={{ fontSize: 44, fontWeight: 700, marginTop: 12, textTransform: "uppercase" }}>{mascot}</div>}
          {rank && <div style={{ fontSize: 40, marginTop: 28 }}>{`${ranked.season} · ${rank}`}</div>}
        </div>
        <div style={{ height: 96, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 72px", background: "#0a2a5e", color: "#ffffff", borderTop: `10px solid ${theme.stripe ?? "#bf1e2e"}` }}>
          <div style={{ fontSize: 40, fontWeight: 900 }}>{SITE_NAME}</div>
          <div style={{ fontSize: 30 }}>{SITE_URL.replace("https://", "")}</div>
        </div>
      </div>
    ),
    { ...size, fonts: await brandFont() },
  );
}
