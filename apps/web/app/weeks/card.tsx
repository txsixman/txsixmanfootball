import type { Org } from "@/lib/orgs";
import { reviewedWeeks } from "@/lib/week-review-load";
import { pageCard } from "../page-card";

/** The link-preview card for one organization's season of weeks in review: how many weeks and games, counted from the pages' own files. */
export async function weeksCard(org: Org, season: number) {
  const weeks = await reviewedWeeks(season, org);
  const games = weeks.reduce((n, w) => n + w.games.length, 0);
  return pageCard({
    kicker: `${org.label} · ${season} season`,
    title: "Week in review",
    lines: [`${weeks.length} weeks, ${games.toLocaleString("en-US")} games`, "Rating movers and results furthest from the projection", "Closest games and playoff advancement"],
  });
}
