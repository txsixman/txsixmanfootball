import type { Org } from "@/lib/orgs";
import { reviewedWeeks } from "@/lib/week-review-load";
import { pageCard } from "../page-card";

/** What one organization's season of weeks in review says on its card: how many weeks and games, counted from the pages' own files
 * (once per organization and season per build worker; the week pages version the card's address by it, lib/card-version.ts). */
export function weeksCardContent(org: Org, season: number) {
  const key = `${org.slug}/${season}`;
  let found = byKey.get(key);
  if (!found) byKey.set(key, (found = load(org, season)));
  return found;
}
const byKey = new Map<string, ReturnType<typeof load>>();

async function load(org: Org, season: number) {
  const weeks = await reviewedWeeks(season, org);
  const games = weeks.reduce((n, w) => n + w.games.length, 0);
  return {
    kicker: `${org.label} · ${season} season`,
    title: "Week in review",
    lines: [`${weeks.length} weeks, ${games.toLocaleString("en-US")} games`, "Upsets, biggest wins and closest games", "Streaks, milestones and playoff advancement"],
  };
}

/** The link-preview card for one organization's season of weeks in review. */
export async function weeksCard(org: Org, season: number) {
  return pageCard(await weeksCardContent(org, season));
}
