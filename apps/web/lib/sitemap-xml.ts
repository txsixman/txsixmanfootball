import { pairKey } from "./meetings";

// The sitemap's XML and each address's <lastmod>. A lastmod comes only from the data (the date of the latest game a page
// shows), never from the build time: search engines trust it only when it is true, and every build would otherwise say
// every page changed. A page with no game date (about, how the ratings work, championships, matchup) has none. Pure.

export type SitemapDates = {
  current: number;
  /** The latest game read this season, and the latest bracket game read this season. */
  latest?: string;
  bracket?: string;
  /** By the id in a game page's address. */
  games: Map<string, string>;
  /** A program's latest game (slug), and its latest game of a season (`<season>|<slug>`). */
  programs: Map<string, string>;
  teams: Map<string, string>;
  /** Two programs' latest meeting, by pairKey. */
  pairs: Map<string, string>;
  seasons: Map<number, string>;
  /** A week's latest game, `<season>|<week>|<org slug>`, or `<season>|<week>|*` for every organization. */
  weeks: Map<string, string>;
};

export type SitemapEntry = { url: string; lastmod?: string };

const DEFAULT_ORG = "uil"; // UIL is the address with no organization segment (ADR 0012)
const number = (s?: string) => (s && /^\d+$/.test(s) ? Number(s) : undefined);

/** The date a page last changed, from its data. `path` has no leading slash; "" is the home page. */
export function lastmodFor(path: string, d: SitemapDates): string | undefined {
  const [section, ...rest] = path.split("/");
  switch (section) {
    case "":
    case "standings":
    case "records":
      return d.latest;
    case "scores":
      return rest.length && rest[0] !== "tonight" ? d.games.get(rest[0]) : (d.bracket ?? d.latest);
    case "playoffs":
      return rest[0] === "season" ? d.seasons.get(Number(rest[1])) : (d.bracket ?? d.latest);
    case "programs":
      if (!rest.length) return d.latest;
      return rest[1] ? d.teams.get(`${rest[1]}|${rest[0]}`) : d.programs.get(rest[0]);
    case "series":
      return d.pairs.get(pairKey(rest[0], rest[1]));
    case "rankings":
      if (rest[0] === "how") return undefined;
      if (rest[0] === "week") return d.weeks.get(`${d.current}|${rest[1]}|*`);
      if (rest[0] === "season") return d.seasons.get(Number(rest[1]));
      return d.latest;
    case "seasons":
      return rest[0] ? d.seasons.get(Number(rest[0])) : d.latest;
    case "results":
    case "weeks": {
      const last = rest.at(-1);
      const org = last !== undefined && number(last) === undefined ? last : DEFAULT_ORG;
      const [season, week] = rest.map(number).filter((n) => n !== undefined);
      if (week !== undefined) return d.weeks.get(`${season}|${week}|${org}`);
      return season !== undefined ? d.seasons.get(season) : d.latest;
    }
    default:
      return undefined;
  }
}

/** The newest of some dates (ISO dates sort as text). */
export const newest = (dates: (string | undefined)[]) => dates.filter((x) => x !== undefined).sort().at(-1);

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const item = (tag: string, { url, lastmod }: SitemapEntry) =>
  `<${tag}><loc>${escape(url)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}</${tag}>`;
const xml = (root: string, tag: string, entries: SitemapEntry[]) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<${root} xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.map((e) => item(tag, e)).join("\n")}\n</${root}>\n`;

export const urlsetXml = (entries: SitemapEntry[]) => xml("urlset", "url", entries);
export const indexXml = (entries: SitemapEntry[]) => xml("sitemapindex", "sitemap", entries);
