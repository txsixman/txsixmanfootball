import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { seasonDescription } from "@/lib/descriptions";
import { hubSeasons, loadSeasonHub } from "@/lib/season-hub";
import { Breadcrumbs } from "../../breadcrumbs";
import { EdgeToEdge } from "../../ui";
import { SeasonHubView } from "../view";

export const dynamic = "force-static";
export const dynamicParams = false;

type Props = { params: Promise<{ year: string }> };

export async function generateStaticParams() {
  return (await hubSeasons()).map((s) => ({ year: String(s) }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { year } = await params;
  if (!(await hubSeasons()).includes(Number(year))) return {};
  const hub = await loadSeasonHub(Number(year));
  return {
    title: `${year} six-man football season`,
    description: seasonDescription({ season: hub.season, games: hub.games, orgs: hub.orgs.map((o) => o.org.label), past: !hub.latest }),
    alternates: { canonical: `/seasons/${year}` },
  };
}

export default async function SeasonPage({ params }: Props) {
  const { year } = await params;
  if (!(await hubSeasons()).includes(Number(year))) notFound();
  const hub = await loadSeasonHub(Number(year));
  return (
    <EdgeToEdge>
      <article aria-labelledby="season" className="mx-auto max-w-3xl border-line bg-white pb-6 sm:border-x">
        <Breadcrumbs trail={[{ name: "Home", href: "/" }, { name: "Seasons", href: "/seasons" }, { name: `${year} season`, href: `/seasons/${year}` }]} />
        <SeasonHubView hub={hub} />
      </article>
    </EdgeToEdge>
  );
}
