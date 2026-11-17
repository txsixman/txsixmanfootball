import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { leaderPages, leaderSeasons, resolveLeaders } from "@/lib/leaders-load";
import { describeLeaders, LeadersView } from "../view";

export const dynamic = "force-static";
export const dynamicParams = false;

type Props = { params: Promise<{ first: string }> };

/** A view of the latest season (/leaders/tapps, /leaders/division-1), or a past season's UIL (/leaders/2025). */
export async function generateStaticParams() {
  const [latest] = await leaderSeasons();
  return (await leaderPages()).flatMap((p) => {
    if (p.season === latest) return p.view.slug ? [{ first: p.view.slug }] : [];
    return p.view.slug ? [] : [{ first: String(p.season) }];
  });
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { first } = await params;
  const page = await resolveLeaders([first]);
  return page ? { ...describeLeaders(page), alternates: { canonical: `/leaders/${first}` } } : {};
}

export default async function LeadersFirstPage({ params }: Props) {
  const page = await resolveLeaders([(await params).first]);
  if (!page) notFound();
  return <LeadersView {...page} />;
}
