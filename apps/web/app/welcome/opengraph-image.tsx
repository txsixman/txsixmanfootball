import { pageCard, cardSize } from "../page-card";
import { loadWelcome } from "./facts";

// The landing page's own share card (ADR 0084): what the site is, and its numbers as of the build.
export const size = cardSize;
export const contentType = "image/png";
export const alt = "Texas six-man football: every team and every game";
export const dynamic = "force-static";

export default async function Card() {
  const f = await loadWelcome();
  return pageCard({
    kicker: "Every Texas team and game",
    title: "Six-man football",
    lines: [
      `${f.programs} programs · ${f.games.toLocaleString("en-US")} games since ${f.firstSeason}`,
      "Scores, rankings, playoff brackets",
      `Every State Championship since ${f.firstFinal}`,
    ],
  });
}
