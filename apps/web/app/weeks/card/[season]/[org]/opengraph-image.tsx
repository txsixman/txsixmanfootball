import { notFound } from "next/navigation";
import { activeOrgs } from "@/lib/active-orgs";
import { orgBySlug } from "@/lib/orgs";
import { resultSeasons } from "@/lib/weeks";
import { cardSize } from "../../../../page-card";
import { weeksCard } from "../../../card";

export const size = cardSize;
export const contentType = "image/png";
export const alt = "A six-man season, week by week";
export const dynamicParams = false;

/** One card per organization and season that has games. */
export async function generateStaticParams() {
  const orgs = await Promise.all((await activeOrgs()).map(async (org) => (await resultSeasons(org)).map((s) => ({ season: String(s), org: org.slug }))));
  return orgs.flat();
}

export default async function Card({ params }: { params: Promise<{ season: string; org: string }> }) {
  const { season, org: slug } = await params;
  const org = orgBySlug(slug);
  if (!org) notFound();
  return weeksCard(org, Number(season));
}
