import { cardSize } from "../page-card";
import { resultsCard } from "./card";

export const size = cardSize;
export const contentType = "image/png";
export const alt = "UIL six-man results, week by week";
export const dynamic = "force-static";

/** UIL's card, the section's default; each other organization's is at /results/card/<org> (see the results page). */
export default function Card() {
  return resultsCard();
}
