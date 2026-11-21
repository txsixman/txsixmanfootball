import { memo } from "@/lib/memo";
import { ORGS, type Org } from "@/lib/orgs";
import { loadWeeks, resultSeasons } from "@/lib/weeks";
import { pageCard } from "../page-card";

/** What one organization's Results card says, counted from the same files as the pages (once per organization per build worker;
 * the results pages version the card's address by it, lib/card-version.ts). */
export const resultsCardContent = memo(async (org: Org) => {
  const seasons = await resultSeasons(org);
  const weeks = await Promise.all(seasons.map((s) => loadWeeks(s, org)));
  const games = weeks.flat().reduce((n, w) => n + w.games.length, 0);
  return {
    kicker: `${org.label} · ${seasons.at(-1)} to ${seasons[0]}`,
    title: "Results",
    lines: [`Every ${org.label} game week by week: ${games.toLocaleString("en-US")} games`, "With each game's projection from the week before"],
  };
});

/** The link-preview card for one organization's Results. */
export async function resultsCard(org: Org = ORGS[0]) {
  return pageCard(await resultsCardContent(org));
}
