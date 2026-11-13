import { ImageResponse } from "next/og";
import { SITE_NAME, SITE_URL } from "../lib/site";
import { brandFont } from "./mark";

// The card a link preview shows for a section page (Playoffs, Results, Records): its name and up to three lines of
// what is on it, drawn at build time from the same data as the page. Navy with the red bar, like the site header.
export const cardSize = { width: 1200, height: 630 };

export async function pageCard({ kicker, title, lines }: { kicker: string; title: string; lines: string[] }) {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", fontFamily: "Barlow Condensed", background: "#0a2a5e", color: "#ffffff" }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 72px" }}>
          <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: 3, textTransform: "uppercase", color: "#ff8a95" }}>{kicker}</div>
          <div style={{ fontSize: 132, fontWeight: 900, lineHeight: 1, marginTop: 8, textTransform: "uppercase" }}>{title}</div>
          {lines.slice(0, 3).map((line) => (
            <div key={line} style={{ fontSize: 38, marginTop: 14, opacity: 0.92, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {line}
            </div>
          ))}
        </div>
        <div style={{ height: 96, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 72px", borderTop: "10px solid #bf1e2e" }}>
          <div style={{ fontSize: 40, fontWeight: 900 }}>{SITE_NAME}</div>
          <div style={{ fontSize: 30 }}>{SITE_URL.replace("https://", "")}</div>
        </div>
      </div>
    ),
    { ...cardSize, fonts: await brandFont() },
  );
}
