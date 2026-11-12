import { playoffLeagues, playoffSeasons } from "@/lib/brackets";
import { cardSize } from "../../../../page-card";
import { playoffsCard } from "../../../card";
import type { League } from "../../../view";

export const size = cardSize;
export const contentType = "image/png";
export const alt = "Six-man playoffs, a past season";
export const dynamicParams = false;
export async function generateStaticParams() {
  const seasons = (await playoffSeasons()).slice(1);
  const pairs = await Promise.all(
    seasons.map(async (s) => (await playoffLeagues(s)).filter((l) => l !== "UIL").map((l) => ({ season: String(s), league: l.toLowerCase() }))),
  );
  return pairs.flat();
}

export default async function Card({ params }: { params: Promise<{ season: string; league: string }> }) {
  const { season, league } = await params;
  return playoffsCard(league.toUpperCase() as League, Number(season));
}
