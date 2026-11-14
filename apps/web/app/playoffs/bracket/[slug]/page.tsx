import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { bracketSlug, latestRound, loadBrackets } from "@/lib/brackets";
import { bracketDescription } from "@/lib/descriptions";
import { CURRENT_SEASON } from "@/lib/season";
import { BracketView } from "../../bracket-view";
import { bracketTitle } from "@/lib/titles";

export const dynamic = "force-static";
export const dynamicParams = false;

type Props = { params: Promise<{ slug: string }> };

/** One page per bracket of the current season: UIL Division I and II each, and each private league's own brackets (ADR 0012). */
export async function generateStaticParams() {
  return (await loadBrackets()).map((b) => ({ slug: bracketSlug(b.name) }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const b = (await loadBrackets()).find((x) => bracketSlug(x.name) === slug);
  return {
    title: b ? bracketTitle({ name: b.name, season: CURRENT_SEASON }) : "Playoff bracket",
    alternates: { canonical: `/playoffs/bracket/${slug}` },
    ...(b && { description: bracketDescription({ name: b.name, season: CURRENT_SEASON, latestRound: latestRound(b)?.label }) }),
  };
}

export default async function BracketPage({ params }: Props) {
  const { slug } = await params;
  const brackets = await loadBrackets();
  const bracket = brackets.find((b) => bracketSlug(b.name) === slug);
  if (!bracket) notFound();
  return <BracketView bracket={bracket} siblings={brackets.filter((b) => b.league === bracket.league)} />;
}
