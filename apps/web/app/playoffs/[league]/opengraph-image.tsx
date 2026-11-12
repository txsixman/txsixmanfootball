import { LEAGUES } from "@/lib/brackets";
import { CURRENT_SEASON } from "@/lib/season";
import { cardSize } from "../../page-card";
import { playoffsCard } from "../card";
import type { League } from "../view";

export const size = cardSize;
export const contentType = "image/png";
export const alt = `Six-man playoffs, ${CURRENT_SEASON}`;
export const dynamicParams = false;
export const generateStaticParams = () => LEAGUES.filter((l) => l !== "UIL").map((l) => ({ league: l.toLowerCase() }));

export default async function Card({ params }: { params: Promise<{ league: string }> }) {
  return playoffsCard((await params).league.toUpperCase() as League);
}
