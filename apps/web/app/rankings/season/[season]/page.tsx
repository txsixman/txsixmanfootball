import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ORGS } from "@/lib/orgs";
import { ratingSeasons } from "@/lib/ratings";
import { RankingsView, viewOf } from "../../view";

export const dynamic = "force-static";
export const dynamicParams = false;

type Props = { params: Promise<{ season: string }> };

/** Every season but the latest, which is /rankings itself. */
const pastSeasons = async () => (await ratingSeasons()).slice(1);

export async function generateStaticParams() {
  return (await pastSeasons()).map((s) => ({ season: String(s) }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { season } = await params;
  return { title: `${season} rankings | Project 80x40` };
}

export default async function SeasonRankingsPage({ params }: Props) {
  const { season } = await params;
  if (!(await pastSeasons()).includes(Number(season))) notFound();
  return <RankingsView view={viewOf(ORGS[0])} season={Number(season)} />;
}
