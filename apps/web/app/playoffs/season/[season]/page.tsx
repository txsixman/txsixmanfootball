import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { playoffSeasons } from "@/lib/brackets";
import { describePlayoffs, PlayoffsView } from "../../view";

export const dynamic = "force-static";
export const dynamicParams = false;

type Props = { params: Promise<{ season: string }> };

/** Past seasons' UIL playoffs; the latest season is /playoffs itself. */
export async function generateStaticParams() {
  return (await playoffSeasons()).slice(1).map((s) => ({ season: String(s) }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { season } = await params;
  return { title: `${season} playoffs`, description: await describePlayoffs("UIL", Number(season)), alternates: { canonical: `/playoffs/season/${season}` } };
}

export default async function SeasonPlayoffsPage({ params }: Props) {
  const { season } = await params;
  if (!(await playoffSeasons()).slice(1).includes(Number(season))) notFound();
  return <PlayoffsView league="UIL" season={Number(season)} />;
}
