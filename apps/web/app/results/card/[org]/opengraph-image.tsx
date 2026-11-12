import { notFound } from "next/navigation";
import { orgParams } from "@/lib/active-orgs";
import { orgBySlug } from "@/lib/orgs";
import { cardSize } from "../../../page-card";
import { resultsCard } from "../../card";

export const size = cardSize;
export const contentType = "image/png";
export const alt = "Six-man results for one organization, week by week";
export const dynamicParams = false;

export const generateStaticParams = orgParams;

export default async function Card({ params }: { params: Promise<{ org: string }> }) {
  const org = orgBySlug((await params).org);
  if (!org) notFound();
  return resultsCard(org);
}
