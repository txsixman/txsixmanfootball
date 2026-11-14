import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { geometry, type Sizes } from "@/lib/bracket-layout";
import { centralClock } from "@/lib/playoff-status";
import { CURRENT_SEASON } from "@/lib/season";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { brandFont } from "../../mark";
import type { Box, BoxSide, TreeData } from "./data";

// The bracket as a picture to download and share (ADR 0049), drawn on the server from the same data and layout as the
// page, so it matches what the page shows when it was built: "share" at 1200 by 630, the size link previews use, in
// small boxes of names and scores; "full" at the page's own size, with each box's code, date and result line. Both carry
// the site's name and address and never name a source (ADRs 0009, 0010).

const NAVY = "#0a2a5e";
const RED = "#bf1e2e";
const INK = "#14213d";
const MUTED = "#55617a";
const LINE = "#cdd6e8";
const PANEL = "#f4f6fb";

export type ImageKind = "share" | "full";
const SHARE = { width: 1200, height: 630 };
const BAND = { share: { top: 64, bottom: 44 }, full: { top: 84, bottom: 56 } };
const MARGIN = 20;

const font = async (weight: 400 | 600) => ({
  name: "Barlow Condensed",
  data: await readFile(join(process.cwd(), `node_modules/@fontsource/barlow-condensed/files/barlow-condensed-latin-${weight}-normal.woff`)),
  weight,
  style: "normal" as const,
});

/** The share size: boxes as large as fit 1200 by 630, never larger than the page's. */
function shareSizes(data: TreeData): Sizes {
  const g = geometry(data, { caption: 0, foot: 0, team: 1, rowGap: 0, gap: 12, header: 22, gutter: 18, boxW: 100 });
  const room = { w: SHARE.width - 2 * MARGIN, h: SHARE.height - BAND.share.top - BAND.share.bottom - 2 * MARGIN };
  const gaps = data.cols - 1;
  const boxW = Math.min(200, Math.floor((room.w - 2 * g.gutter - gaps * 12) / Math.max(1, data.cols)));
  // Each row is a box of two team lines and a gap of a third of a line.
  const team = Math.min(26, Math.floor((room.h - 22) / Math.max(1, (data.rows - 1) * (2 + 1 / 3) + 2)));
  return { caption: 0, foot: 0, team, rowGap: Math.round(team / 3), gap: 12, header: 22, gutter: 18, boxW };
}

function boxFooter(b: Box): string {
  if (b.state === "final") return b.forfeit ? "Forfeit" : "Final";
  if (b.state === "disputed") return "Final · Disputed";
  if (b.state === "bye") return "Bye";
  return [b.projection?.margin, b.site].filter(Boolean).join(" · ") || (b.state === "open" ? "Not listed yet" : "Not played yet");
}

export async function treeImage(data: TreeData, kind: ImageKind): Promise<ImageResponse> {
  const sizes = kind === "share" ? shareSizes(data) : {};
  const geo = geometry(data, sizes);
  const width = kind === "share" ? SHARE.width : geo.width + 2 * MARGIN;
  const height = kind === "share" ? SHARE.height : geo.height + BAND.full.top + BAND.full.bottom + 2 * MARGIN;
  const band = BAND[kind];
  const text = Math.max(11, Math.round(geo.team * (kind === "share" ? 0.62 : 0.34)));
  const byId = new Map(data.boxes.map((b) => [b.id, b]));
  const side = (s: BoxSide, other: BoxSide) => {
    const right = s.score ?? s.chance;
    const lost = other.won && !s.won;
    return (
      <div style={{ display: "flex", alignItems: "center", height: geo.team, padding: "0 6px", fontSize: s.key ? text : text - 1, color: s.won ? INK : lost || !s.key ? MUTED : INK, fontWeight: s.won ? 600 : 400 }}>
        <div style={{ display: "block", flex: 1, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{s.text}</div>
        {right != null && <div style={{ display: "flex", marginLeft: 4, fontWeight: 600, color: typeof right === "string" ? NAVY : s.won ? INK : MUTED, fontSize: typeof right === "string" ? text - 1 : text + 2 }}>{String(right)}</div>}
      </div>
    );
  };
  const small = Math.max(10, text - 3);
  const tree = (
    <div style={{ display: "flex", position: "relative", width: geo.width, height: geo.height }}>
      {data.links.length > 0 && (
        <svg width={geo.width} height={geo.height} style={{ position: "absolute", left: 0, top: 0 }}>
          {data.links.map((l) => (
            <path key={`${l.from}-${l.to}`} d={geo.link(byId.get(l.from)!, byId.get(l.to)!)} fill="none" stroke={LINE} strokeWidth={kind === "share" ? 1.5 : 2} />
          ))}
        </svg>
      )}
      {data.columns.map((label, c) => (
        <div key={c} style={{ position: "absolute", left: geo.x(c), top: 0, width: geo.boxW, height: geo.header - 4, display: "flex", alignItems: "center", justifyContent: "center", fontSize: small + 1, fontWeight: 600, color: NAVY, textTransform: "uppercase", letterSpacing: 1 }}>
          {label}
        </div>
      ))}
      {data.groups.map((g) => (
        <div
          key={`${g.half}-${g.label}`}
          style={{ position: "absolute", left: g.half === "left" ? 0 : geo.width - geo.gutter, top: geo.y(g.top), width: geo.gutter, height: geo.y(g.bottom) - geo.y(g.top) + geo.boxH, display: "flex", alignItems: "center", justifyContent: "center", ...(g.half === "right" ? { borderLeft: `3px solid ${RED}` } : { borderRight: `3px solid ${RED}` }) }}
        >
          {/* Written down the side one letter a line: the drawing library cannot turn text. */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", fontSize: small, fontWeight: 600, color: MUTED, lineHeight: 1 }}>
            {g.label.toUpperCase().replace("REGION ", "R").split("").map((ch, i) => <div key={i} style={{ display: "flex" }}>{ch}</div>)}
          </div>
        </div>
      ))}
      {data.boxes.map((b) => (
        <div
          key={b.id}
          style={{ position: "absolute", left: geo.x(b.col), top: geo.y(b.row), width: geo.boxW, height: geo.boxH, display: "flex", flexDirection: "column", background: "#ffffff", border: `1px ${b.state === "open" ? "dashed" : "solid"} ${b.state === "open" ? "#9aa7c2" : LINE}` }}
        >
          {geo.caption > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", height: geo.caption, padding: "0 6px", fontSize: small, color: MUTED, borderBottom: `1px solid ${LINE}` }}>
              <div style={{ display: "flex", fontWeight: 600 }}>{b.code ?? ""}</div>
              <div style={{ display: "flex" }}>{b.when ?? ""}</div>
            </div>
          )}
          {side(b.sides[0], b.sides[1])}
          {side(b.sides[1], b.sides[0])}
          {geo.foot > 0 && (
            <div style={{ display: "flex", alignItems: "center", height: geo.foot, padding: "0 6px", fontSize: small, color: b.projection ? NAVY : MUTED, borderTop: `1px solid ${LINE}`, overflow: "hidden", whiteSpace: "nowrap" }}>
              {boxFooter(b)}
            </div>
          )}
        </div>
      ))}
    </div>
  );
  return new ImageResponse(
    (
      <div style={{ width, height, display: "flex", flexDirection: "column", background: PANEL, fontFamily: "Barlow Condensed", color: INK }}>
        <div style={{ height: band.top, display: "flex", alignItems: "center", justifyContent: "space-between", padding: `0 ${MARGIN + 8}px`, background: NAVY, color: "#ffffff", borderBottom: `6px solid ${RED}` }}>
          <div style={{ display: "flex", fontSize: kind === "share" ? 34 : 40, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1 }}>{`${CURRENT_SEASON} ${data.name} playoffs`}</div>
          <div style={{ display: "flex", fontSize: kind === "share" ? 20 : 24, color: "#ffd0d4" }}>{`As of ${centralClock().label}`}</div>
        </div>
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>{tree}</div>
        <div style={{ height: band.bottom, display: "flex", alignItems: "center", justifyContent: "space-between", padding: `0 ${MARGIN + 8}px`, background: NAVY, color: "#ffffff" }}>
          <div style={{ display: "flex", fontSize: kind === "share" ? 24 : 28, fontWeight: 700, textTransform: "uppercase", letterSpacing: 2 }}>{SITE_NAME}</div>
          <div style={{ display: "flex", fontSize: kind === "share" ? 20 : 24 }}>{SITE_URL.replace("https://", "")}</div>
        </div>
      </div>
    ),
    { width, height, fonts: [...(await brandFont()), await font(400), await font(600)] },
  );
}
