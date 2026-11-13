import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { resultSeasons } from "@/lib/weeks";
import { cardSize } from "../../page-card";
import { parseWeeksPath, weekPaths } from "../paths";
import { WeekInReview, WeeksIndex } from "../view";

export const dynamic = "force-static";
export const dynamicParams = false;

type Props = { params: Promise<{ path?: string[] }> };

export async function generateStaticParams() {
  return (await weekPaths()).map((path) => ({ path }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const where = await parseWeeksPath((await params).path);
  if (!where) return {};
  const { org, season, week } = where;
  // One card per organization and season (about thirty images, not one per week): it names the season, never a week.
  const year = season ?? (await resultSeasons(org))[0];
  const card = [{ url: `/weeks/card/${year}/${org.slug}/opengraph-image`, ...cardSize, alt: `${org.label} ${year} six-man season, week by week` }];
  return {
    title: season === undefined ? `${org.label} week in review` : `${org.label} ${season} week ${week} in review`,
    openGraph: { images: card },
    twitter: { card: "summary_large_image", images: card },
  };
}

export default async function WeeksPage({ params }: Props) {
  const where = await parseWeeksPath((await params).path);
  if (!where) notFound();
  return where.season === undefined ? <WeeksIndex org={where.org} /> : <WeekInReview org={where.org} season={where.season} week={where.week} />;
}
