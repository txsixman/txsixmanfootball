import { ImageResponse } from "next/og";
import { cardCells, gamesText, moreText, type CardGame } from "../lib/friday-card";
import { SITE_NAME, SITE_URL } from "../lib/site";
import { brandFont } from "./mark";
import { cardSize, pageCard } from "./page-card";

// The card a link preview shows for a page of the night's games (/scores/tonight, /playoffs/this-round): up to six games,
// away team first, each with its league tag and its projection or its score (lib/friday-card.ts), then "+N more". With no
// game it is the section card with a plain line. Drawn at build time from the data the page shows.
export async function gamesCard({ kicker, title, games, empty }: { kicker: string; title: string; games: CardGame[]; empty: string }) {
  if (!games.length) return pageCard({ kicker, title, lines: [empty] });
  const { cells, more } = cardCells(games);
  const one = cells.length <= 3; // a short list gets one wide column and bigger type
  const font = one ? 36 : 30;
  const line = { display: "flex", alignItems: "center" as const };
  const ellipsis = { flex: 1, minWidth: 0, display: "block", overflow: "hidden", whiteSpace: "nowrap" as const, textOverflow: "ellipsis" };
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", fontFamily: "Barlow Condensed", background: "#0a2a5e", color: "#ffffff" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", padding: "26px 56px 6px" }}>
          <div style={{ display: "flex", alignItems: "baseline" }}>
            <div style={{ fontSize: 76, fontWeight: 900, lineHeight: 1, textTransform: "uppercase" }}>{title}</div>
            <div style={{ marginLeft: 24, fontSize: 32, fontWeight: 700, letterSpacing: 3, textTransform: "uppercase", color: "#ff8a95" }}>{kicker}</div>
          </div>
          <div style={{ fontSize: 34, fontWeight: 700, color: "#ff8a95" }}>{moreText(more) || gamesText(cells.length)}</div>
        </div>
        <div style={{ flex: 1, display: "flex", flexWrap: "wrap", alignContent: "flex-start", overflow: "hidden", padding: "0 56px", columnGap: 40 }}>
          {cells.map((c, i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", width: one ? "100%" : 524, marginTop: 8, paddingTop: 6, borderTop: "2px solid #3a5a8e" }}>
              <div style={{ ...line, fontSize: 20, lineHeight: 1.1, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", color: "#ff8a95" }}>
                <div style={ellipsis}>{c.tag}</div>
              </div>
              {([[c.away, c.awayScore], [c.home, c.homeScore]] as const).map(([name, score], j) => (
                <div key={j} style={{ ...line, fontSize: font, fontWeight: 700, lineHeight: 1.05, textTransform: "uppercase" }}>
                  <div style={ellipsis}>{name}</div>
                  {score != null && <div style={{ display: "flex", marginLeft: 16, fontSize: font + 4, lineHeight: 1 }}>{score}</div>}
                </div>
              ))}
              <div style={{ ...line, fontSize: one ? 26 : 23, lineHeight: 1.15, fontWeight: 700, color: c.awayScore != null || c.status === "Forfeit" ? "#ff8a95" : "#d6e0f0" }}>
                <div style={ellipsis}>{c.status}</div>
              </div>
            </div>
          ))}
        </div>
        <div style={{ height: 64, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 56px", borderTop: "8px solid #bf1e2e" }}>
          <div style={{ fontSize: 32, fontWeight: 900 }}>{SITE_NAME}</div>
          <div style={{ fontSize: 26 }}>{SITE_URL.replace("https://", "")}</div>
        </div>
      </div>
    ),
    { ...cardSize, fonts: await brandFont() },
  );
}
