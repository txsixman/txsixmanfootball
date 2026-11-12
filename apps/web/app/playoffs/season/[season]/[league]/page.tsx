import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { playoffLeagues, playoffSeasons } from "@/lib/brackets";
import { PlayoffsView, type League } from "../../../view";

export const dynamic = "force-static";
export const dynamicParams = false;

type Props = { params: Promise<{ season: string; league: string }> };

/** A past season's private leagues that had playoff games that year. */
export async function generateStaticParams() {
  const seasons = (await playoffSeasons()).slice(1);
  const pairs = await Promise.all(
    seasons.map(async (s) => (await playoffLeagues(s)).filter((l) => l !== "UIL").map((l) => ({ season: String(s), league: l.toLowerCase() }))),
  );
  return pairs.flat();
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { season, league } = await params;
  return { title: `${season} ${league.toUpperCase()} playoffs` };
}

export default async function SeasonLeaguePlayoffsPage({ params }: Props) {
  const { season, league } = await params;
  const l = league.toUpperCase() as League;
  if (!(await playoffSeasons()).slice(1).includes(Number(season)) || !(await playoffLeagues(Number(season))).includes(l)) notFound();
  return <PlayoffsView league={l} season={Number(season)} />;
}
