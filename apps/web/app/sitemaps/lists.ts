import { slugify } from "@/lib/alignments";
import { demoGames } from "@/lib/demo-games";
import { loadSeasonResults } from "@/lib/games";
import { pairKey } from "@/lib/meetings";
import { memo } from "@/lib/memo";
import { ORGS } from "@/lib/orgs";
import { CURRENT_SEASON } from "@/lib/season";
import { SITE_URL } from "@/lib/site";
import { lastmodFor, type SitemapDates, type SitemapEntry } from "@/lib/sitemap-xml";
import { loadWeeks, resultSeasons } from "@/lib/weeks";
import { generateStaticParams as playoffLeagues } from "../playoffs/[league]/page";
import { generateStaticParams as brackets } from "../playoffs/bracket/[slug]/page";
import { generateStaticParams as playoffSeasonLeagues } from "../playoffs/season/[season]/[league]/page";
import { generateStaticParams as playoffSeasons } from "../playoffs/season/[season]/page";
import { generateStaticParams as programSeasons } from "../programs/[slug]/[season]/page";
import { generateStaticParams as programs } from "../programs/[slug]/page";
import { generateStaticParams as rankingViews } from "../rankings/[division]/page";
import { generateStaticParams as rankingSeasonOrgs } from "../rankings/season/[season]/[org]/page";
import { generateStaticParams as rankingSeasons } from "../rankings/season/[season]/page";
import { generateStaticParams as rankingWeekOrgs } from "../rankings/week/[week]/[org]/page";
import { generateStaticParams as rankingWeeks } from "../rankings/week/[week]/page";
import { generateStaticParams as recordOrgs } from "../records/[org]/page";
import { generateStaticParams as results } from "../results/[[...path]]/page";
import { generateStaticParams as games } from "../scores/[id]/page";
import { generateStaticParams as seasonHubs } from "../seasons/[year]/page";
import { generateStaticParams as series } from "../series/[first]/[second]/page";
import { generateStaticParams as standings } from "../standings/[group]/page";
import { generateStaticParams as weeks } from "../weeks/[[...path]]/page";

// Every public page, built from the same lists that make the pages (each route's generateStaticParams), so a page and
// its sitemap entry come and go together. /sitemap.xml is an index of one sitemap per kind of page (/sitemaps/<kind>.xml),
// so Search Console counts what is indexed kind by kind. Left out: the invented sample pages and sample games, search,
// the offline page, the embeds (all noindex), and the fan, sign-in and admin pages (privacy and terms too: they exist
// only while fan accounts are on).
export const KINDS = ["sections", "programs", "scores", "series", "results", "weeks"] as const;
type Kind = (typeof KINDS)[number];

const SECTIONS = ["", "scores", "scores/tonight", "playoffs", "playoffs/this-round", "results", "rankings", "rankings/how", "about/ratings", "standings", "programs", "records", "championships", "matchup", "seasons"];
const SAMPLE_GAMES = new Set(demoGames.map((g) => g.id));

const PATHS: Record<Kind, () => Promise<string[]>> = {
  sections: async () => [
    ...SECTIONS,
    ...(await rankingViews()).map((p) => `rankings/${p.division}`),
    ...(await rankingWeeks()).map((p) => `rankings/week/${p.week}`),
    ...(await rankingWeekOrgs()).map((p) => `rankings/week/${p.week}/${p.org}`),
    ...(await rankingSeasons()).map((p) => `rankings/season/${p.season}`),
    ...(await rankingSeasonOrgs()).map((p) => `rankings/season/${p.season}/${p.org}`),
    ...standings().map((p) => `standings/${p.group}`),
    ...playoffLeagues().map((p) => `playoffs/${p.league}`),
    ...(await playoffSeasons()).map((p) => `playoffs/season/${p.season}`),
    ...(await playoffSeasonLeagues()).map((p) => `playoffs/season/${p.season}/${p.league}`),
    ...(await brackets()).map((p) => `playoffs/bracket/${p.slug}`),
    ...(await recordOrgs()).map((p) => `records/${p.org}`),
    ...(await seasonHubs()).map((p) => `seasons/${p.year}`),
  ],
  programs: async () => [
    ...(await programs()).map((p) => `programs/${p.slug}`),
    ...(await programSeasons()).map((p) => `programs/${p.slug}/${p.season}`),
  ],
  scores: async () => (await games()).filter((p) => !SAMPLE_GAMES.has(p.id)).map((p) => `scores/${p.id}`),
  series: async () => (await series()).map((p) => `series/${p.first}/${p.second}`),
  results: async () => (await results()).filter((p) => p.path.length).map((p) => `results/${p.path.join("/")}`),
  weeks: async () => (await weeks()).map((p) => ["weeks", ...(p.path ?? [])].join("/")),
};

const later = <K>(map: Map<K, string>, key: K, date: string) => {
  const was = map.get(key);
  if (was === undefined || date > was) map.set(key, date);
};

/** Every game date the lastmods come from: robot-read results only, so every date is a game already played. */
const dates = memo<void, SitemapDates>(async () => {
  const d: SitemapDates = { current: CURRENT_SEASON, games: new Map(), programs: new Map(), teams: new Map(), pairs: new Map(), seasons: new Map(), weeks: new Map() };
  const latest = new Map<string, string>();
  for (const season of await resultSeasons()) {
    for (const r of await loadSeasonResults(season)) {
      const page = r.href.slice("/scores/".length);
      d.games.set(page, r.date);
      later(d.seasons, season, r.date);
      later(d.pairs, pairKey(slugify(r.home), slugify(r.away)), r.date);
      for (const team of [r.home, r.away]) {
        later(d.programs, slugify(team), r.date);
        later(d.teams, `${season}|${slugify(team)}`, r.date);
      }
      if (season === CURRENT_SEASON) {
        later(latest, "latest", r.date);
        // A current-season playoff game's page is the bracket game's, not its own id (lib/game-pages.ts).
        if (page !== r.id) later(latest, "bracket", r.date);
      }
    }
    for (const org of [undefined, ...ORGS]) {
      for (const w of await loadWeeks(season, org)) {
        for (const g of w.games) later(d.weeks, `${season}|${w.number}|${org?.slug ?? "*"}`, g.date);
      }
    }
  }
  return { ...d, latest: latest.get("latest"), bracket: latest.get("bracket") };
});

/** One kind's addresses, each with its lastmod when its data has a date. */
export const sitemapEntries = memo<Kind, SitemapEntry[]>(async (kind) => {
  const d = await dates();
  return [...new Set(await PATHS[kind]())].map((p) => ({ url: p ? `${SITE_URL}/${p}` : SITE_URL, lastmod: lastmodFor(p, d) }));
});
