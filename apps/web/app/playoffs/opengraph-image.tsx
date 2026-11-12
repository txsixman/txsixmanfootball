import { CURRENT_SEASON } from "@/lib/season";
import { cardSize } from "../page-card";
import { playoffsCard } from "./card";

export const size = cardSize;
export const contentType = "image/png";
export const alt = `UIL six-man playoffs, ${CURRENT_SEASON}`;
export const dynamic = "force-static";

export default function Card() {
  return playoffsCard("UIL");
}
