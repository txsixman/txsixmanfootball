import { ImageResponse } from "next/og";
import { loadAlignments } from "@/lib/alignments";
import { mediumDate } from "@/lib/game-pages";
import { EMPTY, loadIdentities } from "@/lib/identity";
import { winnerOf, type Side } from "@/lib/score-display";
import { brandFont } from "../../../mark";
import { cardSize } from "../../../page-card";
import { CardFrame, TeamRow, tileOf, WhenWhere } from "../../../share-card";
import { cardOf } from "./game-card";
import { cardIds } from "./ids";

// The card a link preview shows when a game page is shared (/scores/<id>/card, the page's og:image): both teams (logo
// from the school's own site, ADR 0006, shown as published beside the name; the school's colors and initials when there
// is none), the round and date, and the score. A game still to play shows its matchup, day, kickoff, site and each team's
// record instead (lib/share-text.ts, ADR 0093). A State Championship's card is titled with its season and bracket and, once the
// game is recorded and confirmed, names the champion (state-card.ts); the score says "Final" only for a confirmed final; a
// robot-read score says "Score reported" and names no winner (ADR 0004). Drawn at build time from the same game the page shows
// (lib/game-pages.ts), so it reflects the last deploy: a score still being played is never on it.
//
// A plain route, not an opengraph-image file: Next gives a route its static params only from its own file, and an
// opengraph-image with generateImageMetadata under [id] cannot list them, so it built no cards and every og:image was a
// 404 (Nov 13, 2026). This route lists this season's games itself, as playoffs/[league]/opengraph-image does.
export const dynamicParams = false;
export const generateStaticParams = async () => (await cardIds()).map((id) => ({ id }));

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { g, text, kicker, kickerSize, banner } = await cardOf(id);
  const [alignments, identities] = await Promise.all([loadAlignments(), loadIdentities()]);
  const tile = (team: { name: string; color: string }) => {
    const slug = alignments.find((a) => a.school === team.name)?.slug;
    return tileOf(slug ? (identities.get(slug) ?? EMPTY) : undefined, team.color); // no slug: an invented sample school
  };
  const winner = winnerOf(g);
  const rows = await Promise.all(
    (["away", "home"] as const).map(async (side: Side) => ({
      team: g[side],
      score: side === "home" ? g.homeScore : g.awayScore,
      record: text.records[side],
      tile: await tile(g[side]),
      lost: winner !== null && winner !== side,
    })),
  );
  return new ImageResponse(
    (
      <CardFrame kicker={kicker} kickerSize={kickerSize} date={!text.upcoming && g.date ? mediumDate(g.date) : undefined} banner={banner} status={text.status}>
        {rows.map(({ team, score, record, tile: t, lost }, i) => (
          <TeamRow key={i} first={i === 0} name={team.name} initials={team.initials} tile={t} score={text.scores ? score : undefined} record={record} dim={lost} compact={text.upcoming} />
        ))}
        <WhenWhere when={text.when} site={text.site} />
      </CardFrame>
    ),
    { ...cardSize, fonts: await brandFont() },
  );
}
