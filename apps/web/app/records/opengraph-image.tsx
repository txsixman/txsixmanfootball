import { cardSize } from "../page-card";
import { recordsCard } from "./card";

export const size = cardSize;
export const contentType = "image/png";
export const alt = "UIL six-man records";
export const dynamic = "force-static";

export default function Card() {
  return recordsCard();
}
