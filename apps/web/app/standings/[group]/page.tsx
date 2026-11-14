import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { describeStandings, GROUPS, StandingsView } from "../view";
import { standingsTitle } from "@/lib/titles";
import { CURRENT_SEASON } from "@/lib/season";

export const dynamic = "force-static";
export const dynamicParams = false;

type Props = { params: Promise<{ group: string }> };
const groups = GROUPS.filter((g) => g.slug);

export function generateStaticParams() {
  return groups.map((g) => ({ group: g.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { group } = await params;
  const found = groups.find((g) => g.slug === group);
  return {
    title: found ? standingsTitle({ label: found.label === "Division II" ? "UIL Division II" : found.label, season: CURRENT_SEASON }) : "Standings",
    ...(found && { description: await describeStandings(found) }),
    alternates: { canonical: `/standings/${group}` },
  };
}

export default async function GroupStandingsPage({ params }: Props) {
  const { group } = await params;
  const found = groups.find((g) => g.slug === group);
  if (!found) notFound();
  return <StandingsView group={found} />;
}
