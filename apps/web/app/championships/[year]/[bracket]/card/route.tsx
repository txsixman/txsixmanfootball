import { ImageResponse } from "next/og";
import { EMPTY, loadIdentities } from "@/lib/identity";
import { initials } from "@/lib/games";
import { CURRENT_SEASON } from "@/lib/season";
import { kickerSize } from "@/lib/share-text";
import { stateChampionships } from "@/lib/state-championships";
import { mediumDate } from "@/lib/game-pages";
import { brandFont } from "../../../../mark";
import { cardSize } from "../../../../page-card";
import { CardFrame, TeamRow, tileOf, WhenWhere } from "../../../../share-card";
import { championshipCardOf } from "./championship-card";

// The card a link preview shows when a State Championship page is shared (/championships/<season>/<bracket>/card, the page's
// og:image): the matchup (a side not known yet reads "Winner of G29") with the day, kickoff, site and each team's record; or,
// once the final is recorded and confirmed, the champion and the score; or the listed score alone while the result is not
// confirmed, naming no champion (ADR 0040, ADR 0083, ADR 0093). A forfeit shows no score. Drawn at build time, so it shows the
// last deploy's data, never a score being played.
export const dynamicParams = false;
export const generateStaticParams = async () => (await stateChampionships(CURRENT_SEASON)).map((c) => ({ year: String(c.season), bracket: c.slug }));

export async function GET(_request: Request, { params }: { params: Promise<{ year: string; bracket: string }> }) {
  const { year, bracket } = await params;
  const { c, text, alignments } = await championshipCardOf(year, bracket);
  const identities = await loadIdentities();
  const played = c.final !== undefined || c.scores !== undefined;
  const rows = await Promise.all(
    c.sides.map(async (s, i) => {
      const slug = s.team ? alignments.find((a) => a.school === s.team)?.slug : undefined;
      const team = s.team ?? "";
      return {
        name: text.names[i],
        initials: s.team ? initials(team) : "?",
        tile: await tileOf(slug ? (identities.get(slug) ?? EMPTY) : undefined, "#1c3a72"),
        score: text.shown[i],
        record: text.records[i],
        // A recorded champion's opponent is dimmed, as the game card does for a confirmed winner.
        lost: c.final !== undefined && s.team !== c.final.champion,
      };
    }),
  );
  return new ImageResponse(
    (
      <CardFrame kicker={text.title} kickerSize={kickerSize(text.title, !played)} date={played && (c.final?.date ?? c.date) ? mediumDate((c.final?.date ?? c.date)!) : undefined} banner={text.banner} status={text.footer}>
        {rows.map((r, i) => (
          <TeamRow key={i} first={i === 0} name={r.name} initials={r.initials} tile={r.tile} score={r.score} dim={r.lost} compact={!played} record={r.record} />
        ))}
        <WhenWhere when={text.when} site={text.site} />
      </CardFrame>
    ),
    { ...cardSize, fonts: await brandFont() },
  );
}
