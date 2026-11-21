import { ImageResponse } from "next/og";
import { SITE_NAME } from "../lib/site";
import { brandFont, Mark } from "./mark";

// The card a link preview shows for every page without its own.
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = SITE_NAME;
export const dynamic = "force-static";

export default async function Card() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", fontFamily: "Barlow Condensed", background: "#0a2a5e", color: "#ffffff", padding: "0 80px", gap: 56 }}>
        <Mark size={260} />
        {/* 1200 less 80 each side, the mark and the gap: the words wrap inside this width instead of running off the card. */}
        <div style={{ display: "flex", flexDirection: "column", width: 724 }}>
          <div style={{ fontSize: 84, fontWeight: 900, lineHeight: 1, textTransform: "uppercase" }}>{SITE_NAME}</div>
          {/* Two lines, broken between the ideas rather than inside "State Championship". */}
          <div style={{ display: "flex", flexDirection: "column", fontSize: 44, lineHeight: 1.15, marginTop: 24, opacity: 0.9 }}>
            <div>Scores, rankings, standings</div>
            <div>and every State Championship</div>
          </div>
        </div>
      </div>
    ),
    { ...size, fonts: await brandFont() },
  );
}
