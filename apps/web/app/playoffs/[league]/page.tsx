import type { Metadata } from "next";
import { LEAGUES } from "@/lib/brackets";
import { PlayoffsView, type League } from "../view";

export const dynamic = "force-static";
export const dynamicParams = false;

const PRIVATE = LEAGUES.filter((l) => l !== "UIL");

export function generateStaticParams() {
  return PRIVATE.map((l) => ({ league: l.toLowerCase() }));
}

export async function generateMetadata({ params }: { params: Promise<{ league: string }> }): Promise<Metadata> {
  const { league } = await params;
  return { title: `${league.toUpperCase()} playoffs | Project 80x40` };
}

export default async function LeaguePlayoffsPage({ params }: { params: Promise<{ league: string }> }) {
  const { league } = await params;
  return <PlayoffsView league={league.toUpperCase() as League} />;
}
