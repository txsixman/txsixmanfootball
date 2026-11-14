import type { Metadata } from "next";
import { seasonsIndexDescription } from "@/lib/descriptions";
import { hubSeasons, loadSeasonHub } from "@/lib/season-hub";
import { Breadcrumbs } from "../breadcrumbs";
import { EdgeToEdge, PageHeader } from "../ui";
import { SeasonList } from "./view";

export const dynamic = "force-static";

export async function generateMetadata(): Promise<Metadata> {
  const seasons = await hubSeasons();
  return {
    title: "Six-man football seasons",
    description: seasonsIndexDescription({ first: seasons.at(-1), latest: seasons[0] }),
    alternates: { canonical: "/seasons" },
  };
}

/** Every season with games read, newest first: one page each, with its state finals, rankings, team leaders and weeks. */
export default async function SeasonsPage() {
  const hubs = await Promise.all((await hubSeasons()).map(loadSeasonHub));
  return (
    <EdgeToEdge>
      <article aria-labelledby="seasons" className="mx-auto max-w-3xl border-line bg-white pb-6 sm:border-x">
        <Breadcrumbs trail={[{ name: "Home", href: "/" }, { name: "Seasons", href: "/seasons" }]} />
        <div className="px-3 pt-5">
          <PageHeader id="seasons" eyebrow="Texas six-man football" title="Seasons" note="One page for each season: the UIL state finals, the final rankings and team leaders of each organization, and every week of results." />
        </div>
        <SeasonList hubs={hubs} />
      </article>
    </EdgeToEdge>
  );
}
