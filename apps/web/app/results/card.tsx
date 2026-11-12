import { ORGS, type Org } from "@/lib/orgs";
import { loadWeeks, resultSeasons } from "@/lib/weeks";
import { pageCard } from "../page-card";

/** The link-preview card for one organization's Results: its games, counted from the same files as the pages. */
export async function resultsCard(org: Org = ORGS[0]) {
  const seasons = await resultSeasons(org);
  const weeks = await Promise.all(seasons.map((s) => loadWeeks(s, org)));
  const games = weeks.flat().reduce((n, w) => n + w.games.length, 0);
  return pageCard({
    kicker: `${org.label} · ${seasons.at(-1)} to ${seasons[0]}`,
    title: "Results",
    lines: [`Every ${org.label} game week by week: ${games.toLocaleString("en-US")} games`, "With each game's projection from the week before"],
  });
}
