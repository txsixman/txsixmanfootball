// The game events an email alert can be about (ADR 0053), worked out from the repo's own data files: a final, a kickoff, and
// the next-round game once the bracket gives both its teams (ADR 0047). Pure: `files` reads the repo, `now` is the clock.
// An event is public facts only; who gets it is the database's call (email_pending_game_alerts).
import { bracketSlots, fill, ROUND_ORDER, uilSlotRows } from "../../apps/web/lib/bracket-fill.ts";
import { forfeitScore } from "../../apps/web/lib/forfeit.ts";
import { slugify } from "../../apps/web/lib/slug.ts";

/** A kickoff alert is due from the listed kickoff until this long after, if the game has no final yet. */
export const KICKOFF_WINDOW_MS = 3 * 60 * 60 * 1000;

/** The site's shared game key (lib/games.ts gameKey): the date, then both program slugs, sorted. */
export const gameKey = (date, a, b) => [date, ...[slugify(a), slugify(b)].sort()].join("|");

/** The rows of one of the repo's plain CSV files (no quoting, one header line); "" is no rows. */
export function csvRows(text) {
  const [header, ...lines] = (text ?? "").replaceAll("\r", "").trim().split("\n");
  if (!header) return [];
  const cols = header.split(",");
  return lines.filter(Boolean).map((line) => {
    const v = line.split(",");
    return Object.fromEntries(cols.map((c, i) => [c, (v[i] ?? "").trim()]));
  });
}

/** What the database accepts as a name and a slug (migration 0022's checks). A game that fails them is skipped and counted, so one odd row never blocks the night. */
const NAME = /^[^<>\r\n]{1,80}$/;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const fits = (e) => NAME.test(e.home_name) && NAME.test(e.away_name) && SLUG.test(e.home_slug) && SLUG.test(e.away_slug) && e.home_slug.length <= 80 && e.away_slug.length <= 80;

const scored = (r) => r.home_score !== "" && r.away_score !== "" && !(r.home_score === "0" && r.away_score === "0");

/**
 * The events of one season now. `files.read(path)` gives a file's text ("" when missing); `files.list(dir)` its folder's names.
 * Returns { events, skipped } where skipped counts rows the database would refuse.
 */
export function gameEvents({ season, now, files }) {
  const seed = (...p) => ["data/seed", ...p].join("/");
  const results = (name) => csvRows(files.read(seed(`maxpreps-${season}`, name)));
  const disputed = new Set(csvRows(files.read(seed("disputed", `${season}.csv`))).map((r) => gameKey(r.game_date, r.home, r.away)));
  const played = [...results("games.csv"), ...results("playoffs.csv")];
  const events = new Map();
  let skipped = 0;
  const add = (e) => {
    if (!fits(e)) {
      skipped += 1;
      return;
    }
    events.set(`${e.alert}|${e.event_key}`, e);
  };

  // Finals: a confirmed score (ADR 0040: not disputed), never a 0-0, never a forfeit (1-0 or 2-0 is not a score to send).
  const finals = new Set();
  for (const r of played) {
    if (!scored(r) || disputed.has(gameKey(r.game_date, r.home, r.away)) || forfeitScore(Number(r.home_score), Number(r.away_score))) continue;
    const key = gameKey(r.game_date, r.home, r.away);
    finals.add(key);
    add({
      alert: "final", event_key: key, home_slug: slugify(r.home), away_slug: slugify(r.away), home_name: r.home, away_name: r.away,
      round: r.round || null, home_score: Number(r.home_score), away_score: Number(r.away_score), kickoff_at: null,
    });
  }

  // Kickoffs: a listed kickoff time that has passed, for up to three hours, while the game has no final.
  for (const r of csvRows(files.read(seed("game-details", `${season}.csv`)))) {
    const start = Date.parse(r.kickoff_utc);
    if (!r.kickoff_utc || Number.isNaN(start) || now < start || now >= start + KICKOFF_WINDOW_MS) continue;
    const key = gameKey(r.date, r.home, r.away);
    if (finals.has(key) || disputed.has(key)) continue;
    add({
      alert: "kickoff", event_key: key, home_slug: slugify(r.home), away_slug: slugify(r.away), home_name: r.home, away_name: r.away,
      round: null, home_score: null, away_score: null, kickoff_at: new Date(start).toISOString(),
    });
  }

  // The next-round game once the bracket gives it both teams, listed by a site yet or not (the same slots as the bracket pages).
  const dirs = files.list("data/seed").filter((d) => /^uil-\d{4}-\d{2}$/.test(d));
  const uil = dirs.flatMap((d) => csvRows(files.read(seed(d, `bracket-${season}.csv`))));
  const slotRows = [...csvRows(files.read(seed("brackets", `${season}.csv`))), ...uilSlotRows(uil)];
  const region = new Map(dirs.flatMap((d) => csvRows(files.read(seed(d, "alignments.csv"))).map((a) => [`${a.league}|${a.division}|${a.school}`, a.region])));
  const playoffs = results("playoffs.csv").filter((r) => r.league);
  for (const [group, rows] of Map.groupBy(playoffs, (r) => `${r.league}|${r.division}`)) {
    const [league, division] = group.split("|");
    const games = rows.map((r) => ({
      round: r.round, date: r.game_date, home: r.home, away: r.away, confirmed: scored(r) && !disputed.has(gameKey(r.game_date, r.home, r.away)),
      ...(scored(r) ? { homeScore: Number(r.home_score), awayScore: Number(r.away_score) } : {}),
    }));
    const slots = bracketSlots(slotRows, games, { league, division, regionOf: (t) => region.get(`${league}|${division}|${t}`) });
    for (const f of fill(slots, games, ROUND_ORDER)) {
      const next = "winnerOf" in f.slot.a || "winnerOf" in f.slot.b; // a slot two teams are placed in by results, not a first-round seed
      if (!next || f.winner || !("team" in f.a) || !("team" in f.b)) continue;
      const [a, b] = [f.a.team, f.b.team];
      add({
        alert: "next_game", event_key: [season, f.slot.round, ...[slugify(a), slugify(b)].sort()].join("|"), home_slug: slugify(a), away_slug: slugify(b),
        home_name: a, away_name: b, round: f.slot.round, home_score: null, away_score: null, kickoff_at: null,
      });
    }
  }
  return { events: [...events.values()], skipped };
}
