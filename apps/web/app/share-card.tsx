import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ReactNode } from "react";
import type { Identity } from "@/lib/identity";
import { memo } from "@/lib/memo";
import { SITE_NAME, SITE_URL } from "@/lib/site";

// The pieces the share images of a game page, a program page and a State Championship page are drawn from (ADR 0093): the frame
// (round and date on top, the status and the site's address below, in the site's navy with the red bar), a team's tile (the
// school's logo as published, ADR 0006 and ADR 0016, else its initials in its colors) and a team's row. Pure drawing: what each
// card says is lib/share-text.ts. Drawn at build time, 1200 by 630, text big enough to read as a small phone thumbnail.

/** The widest logo the site's crests draw (programs/crest.tsx); a wider wordmark gets the badge. */
const MAX_ASPECT = 1.6;

const logoData = memo(async (src: string) => {
  const bytes = await readFile(path.join(process.cwd(), "public", src));
  return `data:${src.endsWith(".svg") ? "image/svg+xml" : "image/png"};base64,${bytes.toString("base64")}`;
});

type Tile = { logo: { uri: string; aspect: number; bg: string } | null; bg: string; fg: string };

/** A school's tile: its logo on white (or on its own color when the mark is light), else its colors for the initials badge.
 * No identity (an invented sample school, or a side not known yet) gets `fallbackBg`. */
export async function tileOf(identity: Identity | undefined, fallbackBg = "#0a2a5e"): Promise<Tile> {
  if (!identity) return { logo: null, bg: fallbackBg, fg: "#ffffff" };
  const logo = identity.logo && identity.logo.aspect <= MAX_ASPECT ? identity.logo : null;
  return { logo: logo && { uri: await logoData(logo.src), aspect: logo.aspect, bg: logo.light ? identity.theme.bg : "#ffffff" }, bg: identity.theme.bg, fg: identity.theme.fg };
}

/** A logo of any shape, for the program card's one big tile: the logo as published on white (or its color), or the badge. */
export async function logoOf(identity: Identity): Promise<{ uri: string; aspect: number; bg: string } | null> {
  if (!identity.logo) return null;
  return { uri: await logoData(identity.logo.src), aspect: identity.logo.aspect, bg: identity.logo.light ? identity.theme.bg : "#ffffff" };
}

function TileView({ tile, initials, size }: { tile: Tile; initials: string; size: number }) {
  return (
    <div style={{ display: "flex", justifyContent: "center", width: size * MAX_ASPECT }}>
      {tile.logo ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: size * Math.max(1, tile.logo.aspect), height: size, padding: 12, background: tile.logo.bg }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- drawn into the image at build time, as published (ADR 0006) */}
          <img src={tile.logo.uri} alt="" width={(size - 24) * Math.max(1, tile.logo.aspect)} height={size - 24} style={{ objectFit: "contain" }} />
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: size, height: size, background: tile.bg, color: tile.fg, border: "4px solid #ffffff", fontSize: size * 0.43, fontWeight: 700 }}>{initials}</div>
      )}
    </div>
  );
}

/** A team's name steps down with its length so it fits beside its score. */
const nameSize = (name: string, scale: number) => Math.round((name.length > 30 ? 46 : name.length > 20 ? 58 : 72) * scale);

export function TeamRow({
  name, tile, initials, score, record, dim, compact, first,
}: {
  name: string; tile: Tile; initials: string; score?: number | null; record?: string; dim?: boolean; compact?: boolean; first?: boolean;
}) {
  const size = compact ? 120 : 150;
  return (
    <div style={{ display: "flex", alignItems: "center", marginTop: first ? 0 : compact ? 20 : 28, opacity: dim ? 0.65 : 1 }}>
      <TileView tile={tile} initials={initials} size={size} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", marginLeft: 36 }}>
        <div style={{ display: "flex", fontSize: nameSize(name, compact ? 0.9 : 1), fontWeight: 700, lineHeight: 1, textTransform: "uppercase" }}>{name}</div>
        {record && <div style={{ display: "flex", marginTop: 8, fontSize: 40, fontWeight: 700, color: "#ff8a95" }}>{`Record ${record}`}</div>}
      </div>
      {score != null && <div style={{ display: "flex", marginLeft: 24, fontSize: 120, fontWeight: 700, lineHeight: 1 }}>{score}</div>}
    </div>
  );
}

/** The day, time and site of a game still to play, under the matchup. */
export function WhenWhere({ when, site }: { when?: string; site?: string }) {
  if (!when && !site) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", marginTop: 24 }}>
      {when && <div style={{ display: "flex", fontSize: 56, fontWeight: 700, lineHeight: 1, textTransform: "uppercase", color: "#ffd24a" }}>{when}</div>}
      {site && <div style={{ display: "flex", marginTop: 8, fontSize: site.length > 34 ? 34 : 42, fontWeight: 700 }}>{site}</div>}
    </div>
  );
}

/** The frame of a game or State Championship card: `kicker` and `date` on the top line, an optional gold `banner`, the body
 * centered, and the footer's `status` with the site's address. */
export function CardFrame({
  kicker, kickerSize = 34, date, banner, status, children,
}: {
  kicker: string; kickerSize?: number; date?: string; banner?: string; status: string; children: ReactNode;
}) {
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", fontFamily: "Barlow Condensed", background: "#0a2a5e", color: "#ffffff" }}>
      <div style={{ display: "flex", justifyContent: "space-between", padding: "40px 72px 0", fontSize: 34, fontWeight: 700, letterSpacing: 3, textTransform: "uppercase", color: "#ff8a95" }}>
        <div style={{ display: "flex", fontSize: kickerSize }}>{kicker}</div>
        {date && <div>{date}</div>}
      </div>
      {banner && <div style={{ display: "flex", padding: "14px 72px 0", fontSize: banner.length > 40 ? 44 : 56, fontWeight: 700, lineHeight: 1, letterSpacing: 2, textTransform: "uppercase", color: "#ffd24a" }}>{banner}</div>}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 72px" }}>{children}</div>
      <div style={{ height: 96, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 72px", borderTop: "10px solid #bf1e2e" }}>
        <div style={{ display: "flex", fontSize: 40, fontWeight: 700, textTransform: "uppercase", letterSpacing: 2 }}>{`${status} · ${SITE_NAME}`}</div>
        <div style={{ display: "flex", fontSize: 30 }}>{SITE_URL.replace("https://", "")}</div>
      </div>
    </div>
  );
}
