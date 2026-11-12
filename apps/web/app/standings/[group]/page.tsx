import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GROUPS, StandingsView } from "../view";

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
  return { title: `${found ? (found.label === "Division II" ? "UIL Division II" : found.label) : ""} standings | Project 80x40` };
}

export default async function GroupStandingsPage({ params }: Props) {
  const { group } = await params;
  const found = groups.find((g) => g.slug === group);
  if (!found) notFound();
  return <StandingsView group={found} />;
}
