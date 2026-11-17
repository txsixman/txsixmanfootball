import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { leaderPages, leaderSeasons, resolveLeaders } from "@/lib/leaders-load";
import { describeLeaders, LeadersView } from "../../view";

export const dynamic = "force-static";
export const dynamicParams = false;

type Props = { params: Promise<{ first: string; second: string }> };

/** A view of a past season: /leaders/2025/tapps, /leaders/2025/division-1. */
export async function generateStaticParams() {
  const [latest] = await leaderSeasons();
  return (await leaderPages()).filter((p) => p.season !== latest && p.view.slug).map((p) => ({ first: String(p.season), second: p.view.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { first, second } = await params;
  const page = await resolveLeaders([first, second]);
  return page ? { ...describeLeaders(page), alternates: { canonical: `/leaders/${first}/${second}` } } : {};
}

export default async function LeadersSecondPage({ params }: Props) {
  const { first, second } = await params;
  const page = await resolveLeaders([first, second]);
  if (!page) notFound();
  return <LeadersView {...page} />;
}
