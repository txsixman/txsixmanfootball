import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ORGS } from "@/lib/orgs";
import { cardSize } from "../../page-card";
import { parseResultsPath, resultPaths } from "../paths";
import { ResultsWeek } from "../view";

export const dynamic = "force-static";
export const dynamicParams = false;

type Props = { params: Promise<{ path?: string[] }> };

export async function generateStaticParams() {
  return (await resultPaths()).map((path) => ({ path }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { path } = await params;
  const where = await parseResultsPath(path);
  if (!where) return {};
  const { org, season, week } = where;
  const dated = (path ?? []).filter((p) => /^\d+$/.test(p)).length;
  const when = dated === 2 ? `${season} week ${week} ` : dated === 1 ? `${season} ` : "";
  const title = `${org.label} ${when}results`;
  // UIL's card is the section's own (opengraph-image.tsx beside this folder); each other organization has its own, so
  // its pages never preview with UIL's numbers.
  if (org === ORGS[0]) return { title };
  const card = [{ url: `/results/card/${org.slug}/opengraph-image`, ...cardSize, alt: `${org.label} six-man results, week by week` }];
  return { title, openGraph: { images: card }, twitter: { card: "summary_large_image", images: card } };
}

export default async function ResultsPage({ params }: Props) {
  const { path } = await params;
  const where = await parseResultsPath(path);
  if (!where) notFound();
  // A dated week is in the site search (app/search) under its organization, season and week. The undated pages
  // (/results, /results/<season>) repeat a week that is already indexed, so they are left out.
  if ((path ?? []).filter((p) => /^\d+$/.test(p)).length < 2) return <ResultsWeek {...where} />;
  const name = `${where.org === ORGS[0] ? "" : `${where.org.label} `}${where.season} week ${where.week} results`;
  return (
    <div data-pagefind-body data-pagefind-meta={`title:${name}`}>
      <ResultsWeek {...where} />
    </div>
  );
}
