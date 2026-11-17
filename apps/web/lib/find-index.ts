import { heading, loadAlignments, placeLabel } from "./alignments";
import { loadFinals } from "./champions";
import { loadIdentities } from "./identity";
import { loadAliases, loadLineage, loadNames, otherNames } from "./lineage";
import { programSeasonPages } from "./program-seasons";
import { loadSeries } from "./series-data";
import { hubSeasons } from "./season-hub";
import { DEFAULT_THEME, type WireEntry, type WireIndex } from "./find";
import { memo } from "./memo";
import { CURRENT_SEASON } from "./season";

/** Seasons as ranges: [2018, 2019, 2020, 2022] is "2018-2020, 2022". @public (the tests read it) */
export function ranges(seasons: number[]): string {
  const out: string[] = [];
  for (let i = 0; i < seasons.length; ) {
    let j = i;
    while (seasons[j + 1] === seasons[j] + 1) j++;
    out.push(j > i ? `${seasons[i]}-${seasons[j]}` : `${seasons[i]}`);
    i = j + 1;
  }
  return out.join(", ");
}

/** @public (the tests read it) The two-program pairs that have a series page, as one bit each, base64: pair (lo, hi) is bit hi*(hi-1)/2 + lo. */
export function packPairs(pairs: [number, number][], programs: number): string {
  const bytes = new Uint8Array(Math.ceil((programs * (programs - 1)) / 2 / 8));
  for (const [x, y] of pairs) {
    const [lo, hi] = x < y ? [x, y] : [y, x];
    const n = (hi * (hi - 1)) / 2 + lo;
    bytes[n >> 3] |= 1 << (n & 7);
  }
  return Buffer.from(bytes).toString("base64");
}

/**
 * What the search page finds by, read when the site is built (ADR 0090): every program with its other names, mascot, league
 * lines and seasons with a page, which pairs have a series page, and the years with a season or State Championship page.
 * Shared: never mutate it.
 */
export const loadFindIndex = memo<void, WireIndex>(async () => {
  const [alignments, identities, seasons, series, finals, hub, lineage, aliases, names] = await Promise.all([
    loadAlignments(), loadIdentities(), programSeasonPages(), loadSeries(), loadFinals(), hubSeasons(), loadLineage(), loadAliases(), loadNames(),
  ]);
  const slugs = [...new Set(alignments.map((a) => a.slug))].sort();
  const programs = new Set(slugs);
  const entries: WireEntry[] = slugs.map((slug) => {
    const rows = alignments.filter((a) => a.slug === slug);
    const identity = identities.get(slug);
    const where = rows.map((r) => {
      const place = placeLabel(r);
      return place === "Teams" || place === r.league || /not listed/i.test(place) ? heading(r) : `${heading(r)} · ${place}`;
    });
    const aka = [...new Set(otherNames(slug, lineage, aliases, { names, programs }).map((n) => n.name))];
    const logo = identity?.logo;
    const theme = identity?.theme;
    const lit = theme && (theme.bg !== DEFAULT_THEME.bg || theme.fg !== DEFAULT_THEME.fg || theme.stripe !== DEFAULT_THEME.stripe);
    return {
      school: rows[0].school,
      where,
      ...(identity?.mascot ? { mascot: identity.mascot } : {}),
      ...(aka.length ? { aka } : {}),
      seasons: ranges([...(seasons.get(slug) ?? [])].sort((x, y) => x - y)),
      // A badge (no logo) or a light mark draws the colors; every other crest needs none.
      ...(logo ? { logo: [logo.tiny.replace("/logos/tiny/", ""), logo.aspect, logo.light ? 1 : 0] as [string, number, 0 | 1] } : {}),
      ...(lit && (!logo || logo.light || logo.aspect > 1.6) ? { theme: [theme.bg, theme.fg, theme.stripe ?? ""] as [string, string, string] } : {}),
    };
  });
  const slot = new Map(slugs.map((s, i) => [s, i]));
  const pairs = series.flatMap((s): [number, number][] => (slot.has(s.first) && slot.has(s.second) ? [[slot.get(s.first)!, slot.get(s.second)!]] : []));
  return {
    entries,
    pairs: packPairs(pairs, slugs.length),
    years: hub,
    titles: [...new Set([...finals.map((f) => f.season), CURRENT_SEASON])].sort((a, b) => a - b),
  };
});
