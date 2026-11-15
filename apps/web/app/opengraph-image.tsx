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
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 96, fontWeight: 900, lineHeight: 1, textTransform: "uppercase" }}>{SITE_NAME}</div>
          <div style={{ fontSize: 40, marginTop: 24, opacity: 0.9 }}>Scores, rankings, standings and every State Championship</div>
        </div>
      </div>
    ),
    { ...size, fonts: await brandFont() },
  );
}
