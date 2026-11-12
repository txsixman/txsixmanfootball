import { ORGS, type Org } from "@/lib/orgs";
import { loadRecords } from "@/lib/records";
import { pageCard } from "../page-card";

/** The link-preview card for one organization's Records, from the same numbers as the page. */
export async function recordsCard(org: Org = ORGS[0]) {
  const r = await loadRecords(org);
  const [points] = r.mostPoints;
  const [run] = r.streaks;
  return pageCard({
    kicker: `${org.label} · ${r.seasons.at(-1)} to ${r.seasons[0]} · ${r.games.toLocaleString("en-US")} games`,
    title: "Records",
    lines: [
      points ? `Most points in a game: ${points.points}, ${points.team} (${points.season})` : "Most points in a game",
      run ? `Longest winning run: ${run.wins}, ${run.team}${run.current ? ", still going" : ""}` : "Longest winning runs",
      "Biggest upsets and unbeaten seasons",
    ],
  });
}
