import { playoffSeasons } from "@/lib/brackets";
import { cardSize } from "../../../page-card";
import { playoffsCard } from "../../card";

export const size = cardSize;
export const contentType = "image/png";
export const alt = "UIL six-man playoffs, a past season";
export const dynamicParams = false;
export const generateStaticParams = async () => (await playoffSeasons()).slice(1).map((s) => ({ season: String(s) }));

export default async function Card({ params }: { params: Promise<{ season: string }> }) {
  return playoffsCard("UIL", Number((await params).season));
}
