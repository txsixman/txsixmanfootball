import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { bracketSlug, loadBrackets } from "@/lib/brackets";
import { BracketView } from "../../bracket-view";

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
  return { title: `${b?.name ?? "Bracket"} playoff bracket` };
}

export default async function BracketPage({ params }: Props) {
  const { slug } = await params;
  const brackets = await loadBrackets();
  const bracket = brackets.find((b) => bracketSlug(b.name) === slug);
  if (!bracket) notFound();
  return <BracketView bracket={bracket} siblings={brackets.filter((b) => b.league === bracket.league)} />;
}
