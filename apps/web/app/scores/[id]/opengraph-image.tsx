import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { loadAlignments } from "@/lib/alignments";
import type { Team } from "@/lib/demo-games";
import { findGame, gameIds, mediumDate, resolveGame } from "@/lib/game-pages";
import { CURRENT_SEASON } from "@/lib/season";
import { EMPTY, loadIdentities } from "@/lib/identity";
import { memo } from "@/lib/memo";
import { isForfeit, winnerOf, type Side } from "@/lib/score-display";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { brandFont } from "../../mark";

// The card a link preview shows when a game page is shared: both teams (logo from the school's own site, ADR 0006,
// shown as published beside the name; the school's colors and initials when there is none), the date, and the score.
// The score says "Final" only for a confirmed final; a robot-read score says "Unconfirmed" and names no winner (ADR 0004).
// An unplayed game shows no score. Drawn at build time from the same game the page shows (lib/game-pages.ts).
const size = { width: 1200, height: 630 };
export const dynamicParams = false;

/** This season's games (bracket and sample games, and robot-read games of the current season) get a card; a past season's
 * game page shares the site's card. One card per game of every season would be ~6,800 images drawn on every build. */
const hasCard = async (id: string) => ((await findGame(id))?.season ?? CURRENT_SEASON) === CURRENT_SEASON;
const cardIds = memo<void, string[]>(async () => {
  const ids = await gameIds();
  const keep = await Promise.all(ids.map(hasCard));
  return ids.filter((_, i) => keep[i]);
});

// Next builds this route's static params from the segment layout's ids (layout.tsx) and this list (one "card" image,
// or none).
export async function generateImageMetadata({ params }: { params: { id: string } | Promise<{ id: string }> }) {
  const { id } = await params;
  return (await cardIds()).includes(id) ? [{ id: "card", size, alt: "Game card", contentType: "image/png" }] : [];
}

const TILE = 150;
/** The widest logo the site's crests draw (programs/crest.tsx); a wider wordmark gets the badge. */
const MAX_ASPECT = 1.6;

const logoData = memo(async (src: string) => {
  const bytes = await readFile(path.join(process.cwd(), "public", src));
  return `data:${src.endsWith(".svg") ? "image/svg+xml" : "image/png"};base64,${bytes.toString("base64")}`;
});

export default async function Card({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const game = (await resolveGame(id))!;
  const { g } = game;
  const [alignments, identities] = await Promise.all([loadAlignments(), loadIdentities()]);
  const tile = async (team: Team) => {
    const slug = alignments.find((a) => a.school === team.name)?.slug;
    const identity = (slug && identities.get(slug)) || EMPTY;
    const logo = identity.logo && identity.logo.aspect <= MAX_ASPECT ? identity.logo : null;
    return slug
      ? { logo: logo && { uri: await logoData(logo.src), aspect: logo.aspect, bg: logo.light ? identity.theme.bg : "#ffffff" }, bg: identity.theme.bg, fg: identity.theme.fg }
      : { logo: null, bg: team.color, fg: "#ffffff" }; // an invented sample school
  };
  const forfeit = isForfeit(g);
  const played = g.state === "final" && !forfeit && g.homeScore != null && g.awayScore != null;
  const winner = winnerOf(g);
  const status = forfeit ? "Forfeit" : played ? (g.verification === "confirmed" ? "Final" : "Unconfirmed") : g.state === "postponed" ? "Postponed" : "Scheduled";
  const rows = await Promise.all(
    (["away", "home"] as const).map(async (side: Side) => ({ team: g[side], score: side === "home" ? g.homeScore : g.awayScore, tile: await tile(g[side]), lost: winner !== null && winner !== side })),
  );
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", fontFamily: "Barlow Condensed", background: "#0a2a5e", color: "#ffffff" }}>
        <div style={{ display: "flex", justifyContent: "space-between", padding: "40px 72px 0", fontSize: 34, fontWeight: 700, letterSpacing: 3, textTransform: "uppercase", color: "#ff8a95" }}>
          <div>{g.league.replace(/\. Sample game.*/, "")}</div>
          {g.date && <div>{mediumDate(g.date)}</div>}
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 72px" }}>
          {rows.map(({ team, score, tile: t, lost }, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", marginTop: i ? 28 : 0, opacity: lost ? 0.65 : 1 }}>
              <div style={{ display: "flex", justifyContent: "center", width: TILE * MAX_ASPECT }}>
              {t.logo ? (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: TILE * Math.max(1, t.logo.aspect), height: TILE, padding: 12, background: t.logo.bg }}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- drawn into the image at build time, as published (ADR 0006) */}
                  <img src={t.logo.uri} alt="" width={(TILE - 24) * Math.max(1, t.logo.aspect)} height={TILE - 24} style={{ objectFit: "contain" }} />
                </div>
              ) : (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: TILE, height: TILE, background: t.bg, color: t.fg, border: "4px solid #ffffff", fontSize: 64, fontWeight: 700 }}>{team.initials}</div>
              )}
              </div>
              <div style={{ flex: 1, display: "flex", marginLeft: 36, fontSize: team.name.length > 30 ? 46 : team.name.length > 20 ? 58 : 72, fontWeight: 700, lineHeight: 1, textTransform: "uppercase" }}>{team.name}</div>
              {played && <div style={{ display: "flex", marginLeft: 24, fontSize: 120, fontWeight: 700, lineHeight: 1 }}>{score}</div>}
            </div>
          ))}
        </div>
        <div style={{ height: 96, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 72px", borderTop: "10px solid #bf1e2e" }}>
          <div style={{ display: "flex", fontSize: 40, fontWeight: 700, textTransform: "uppercase", letterSpacing: 2 }}>{`${status} · ${SITE_NAME}`}</div>
          <div style={{ display: "flex", fontSize: 30 }}>{SITE_URL.replace("https://", "")}</div>
        </div>
      </div>
    ),
    { ...size, fonts: await brandFont() },
  );
}
