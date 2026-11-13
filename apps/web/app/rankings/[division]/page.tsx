import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { activeOrgs } from "@/lib/active-orgs";
import { RankingsView, VIEWS } from "../view";

export const dynamic = "force-static";
export const dynamicParams = false;

type Props = { params: Promise<{ division: string }> };

const views = VIEWS.filter((v) => v.slug);

export async function generateStaticParams() {
  const orgs = await activeOrgs();
  return views.filter((v) => orgs.includes(v.org)).map((v) => ({ division: v.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { division } = await params;
  const view = views.find((v) => v.slug === division);
  return { title: `${view?.eyebrow ?? "Rankings"} rankings` };
}

export default async function DivisionRankingsPage({ params }: Props) {
  const { division } = await params;
  const view = views.find((v) => v.slug === division);
  if (!view) notFound();
  return <RankingsView view={view} />;
}
