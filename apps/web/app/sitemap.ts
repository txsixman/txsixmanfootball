import type { MetadataRoute } from "next";
import { SITE_URL } from "../lib/site";
import { generateStaticParams as playoffLeagues } from "./playoffs/[league]/page";
import { generateStaticParams as playoffSeasons } from "./playoffs/season/[season]/page";
import { generateStaticParams as playoffSeasonLeagues } from "./playoffs/season/[season]/[league]/page";
import { generateStaticParams as programs } from "./programs/[slug]/page";
import { generateStaticParams as rankingViews } from "./rankings/[division]/page";
import { generateStaticParams as rankingSeasons } from "./rankings/season/[season]/page";
import { generateStaticParams as rankingSeasonOrgs } from "./rankings/season/[season]/[org]/page";
import { generateStaticParams as rankingWeeks } from "./rankings/week/[week]/page";
import { generateStaticParams as rankingWeekOrgs } from "./rankings/week/[week]/[org]/page";
import { generateStaticParams as recordOrgs } from "./records/[org]/page";
import { generateStaticParams as results } from "./results/[[...path]]/page";
import { generateStaticParams as games } from "./scores/[id]/page";
import { generateStaticParams as standings } from "./standings/[group]/page";

// Every public page, built from the same lists that make the pages (each route's generateStaticParams), so a page and
// its sitemap entry come and go together. Left out: the invented sample pages, search and the offline page (noindex).
const SECTIONS = ["", "scores", "playoffs", "results", "rankings", "rankings/how", "standings", "programs", "records", "championships", "matchup"];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const paths = [
    ...SECTIONS,
    ...(await programs()).map((p) => `programs/${p.slug}`),
    ...(await results()).filter((p) => p.path.length).map((p) => `results/${p.path.join("/")}`),
    ...(await rankingViews()).map((p) => `rankings/${p.division}`),
    ...(await rankingWeeks()).map((p) => `rankings/week/${p.week}`),
    ...(await rankingWeekOrgs()).map((p) => `rankings/week/${p.week}/${p.org}`),
    ...(await rankingSeasons()).map((p) => `rankings/season/${p.season}`),
    ...(await rankingSeasonOrgs()).map((p) => `rankings/season/${p.season}/${p.org}`),
    ...standings().map((p) => `standings/${p.group}`),
    ...playoffLeagues().map((p) => `playoffs/${p.league}`),
    ...(await playoffSeasons()).map((p) => `playoffs/season/${p.season}`),
    ...(await playoffSeasonLeagues()).map((p) => `playoffs/season/${p.season}/${p.league}`),
    ...(await recordOrgs()).map((p) => `records/${p.org}`),
    ...(await games()).map((p) => `scores/${p.id}`),
  ];
  return paths.map((p) => ({ url: p ? `${SITE_URL}/${p}` : SITE_URL }));
}
