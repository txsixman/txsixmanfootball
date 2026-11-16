// Next-round bracket games no listing has yet, for the morning kickoff read (ADR 0067): a league's own bracket file (UIL's
// data/seed/uil-<span>/bracket-<year>.csv, a robot-read data/seed/brackets/<year>.csv) filled with the season's finals,
// the same way the playoff pages fill it (apps/web/lib/bracket-fill.ts, ADR 0047). Only a pairing whose two teams are both
// set by winners is due; a side still waiting on a game is not. No date: the feed's kickoff gives it.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bracketSlots, builtGames, fill, ownSlots, pageOrders, ROUND_ORDER, uilSlotRows } from "../../apps/web/lib/bracket-fill.ts";
import { parseCsv } from "./store.mjs";

/** A playoffs.csv row as the bracket fill reads a game: a scored game is final (ADR 0013), a forfeit by its 1-0 or 2-0. */
export function fillGame(r) {
  const scored = r.home_score !== "" && r.away_score !== "";
  return {
    round: r.round, date: r.game_date, home: r.home, away: r.away, confirmed: scored,
    ...(scored ? { homeScore: Number(r.home_score), awayScore: Number(r.away_score) } : {}),
  };
}

/** playoffs.csv rows without the games a correction voids (the last correction for a game wins; the site drops them). */
export function withoutVoided(playoffs, correctionsText) {
  const void_ = new Set();
  const [, ...lines] = correctionsText.trim().split("\n");
  for (const line of lines) {
    const [date, home, away, action] = line.split(",");
    if (!date || !home || !away) continue;
    const key = [date, ...[home, away].sort()].join("|");
    if (action === "void") void_.add(key);
    else void_.delete(key);
  }
  return playoffs.filter((r) => !void_.has([r.game_date, ...[r.home, r.away].sort()].join("|")));
}

/**
 * Due rows for every next-round pairing the bracket sets by winners and no listed game holds yet: { league, division,
 * round, game_date: "", home, away, home_score: "", built: true }, home and away as the bracket's slot lists them (a
 * bracket's home is only its designation). `slotRows`: SlotRow[] (bracket-fill.ts); `playoffs`: playoffs.csv rows.
 */
export function builtDue(slotRows, playoffs) {
  const out = [];
  for (const [both] of Map.groupBy(slotRows, (r) => `${r.league}|${r.division}`)) {
    const [league, division] = both.split("|");
    const games = playoffs.filter((r) => r.league === league && r.division === division).map(fillGame);
    const slots = ownSlots(slotRows, { league, division });
    for (const b of builtGames(fill(slots, games, ROUND_ORDER))) {
      const [a, c] = b.sides;
      if (!("team" in a) || !("team" in c)) continue;
      out.push({ league, division, round: b.round, game_date: "", home: a.team, away: c.team, home_score: "", away_score: "", built: true });
    }
  }
  return out;
}

/**
 * Every game the bracket sets by winners whose two teams are known, listed yet or not, as { league, division, round, home,
 * away } in the bracket's own order (ADR 0079: home the slot's first side, away its second), the order the pages' ids use
 * (pageOrders, bracket-fill.ts). Each league and division of the playoffs rows (and of the slot rows) is its own bracket: its
 * own slots when a file has them, else the semifinals-to-final slots the data closes (TAPPS and TCAF have no slot file).
 * `corrections`: data/corrections/games.csv's text; a game it voids is dropped before the bracket is filled.
 */
export function pagePairings(slotRows, playoffs, { corrections = "" } = {}) {
  const rows = withoutVoided(playoffs, corrections);
  const brackets = new Set([...rows, ...slotRows].map((r) => `${r.league}|${r.division}`));
  const out = [];
  for (const both of [...brackets].sort()) {
    const [league, division] = both.split("|");
    const games = rows.filter((r) => r.league === league && r.division === division).map(fillGame);
    const slots = bracketSlots(slotRows, games, { league, division });
    for (const p of pageOrders(slots, fill(slots, games, ROUND_ORDER))) out.push({ league, division, ...p });
  }
  return out;
}

/** The season's slot rows from the seed folder: UIL's own bracket files and the robot-read bracket file. */
export function seasonSlotRows(seedDir, season) {
  const read = (f, name) => (existsSync(f) ? parseCsv(readFileSync(f, "utf8"), name).rows : []);
  const uil = readdirSync(seedDir)
    .filter((d) => /^uil-\d{4}-\d{2}$/.test(d))
    .flatMap((d) => uilSlotRows(read(path.join(seedDir, d, `bracket-${season}.csv`), "UIL bracket")));
  return [...uil, ...read(path.join(seedDir, "brackets", `${season}.csv`), "bracket slots")];
}

/**
 * The playoff-week rule (results-watch.yml's details read): how many playoff games are still to play. Every unscored
 * playoffs.csv row dated today or later (or not dated yet), plus every next-round pairing the bracket sets by winners that no
 * listing holds yet (builtDue). It reads the brackets' unplayed rounds, never a date list: 0 means no playoff game is left
 * to place, so the read is skipped. `today`: the Central date, YYYY-MM-DD.
 */
export function playoffWeekCount(slotRows, playoffs, today) {
  const listed = playoffs.filter((r) => r.home_score === "" && (r.game_date === "" || r.game_date >= today)).length;
  return listed + builtDue(slotRows, playoffs).length;
}

const centralToday = (now = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(now);

/** `--playoff-week <seedDir> <season>`: prints playoffWeekCount for the season's published files (a missing playoffs.csv counts none listed). */
function playoffWeek() {
  const [seedDir, season] = process.argv.slice(process.argv.indexOf("--playoff-week") + 1);
  if (!seedDir || !/^20\d\d$/.test(season ?? "")) throw new Error("usage: bracket-due.mjs --playoff-week <seedDir> <season>");
  const file = path.join(seedDir, `maxpreps-${season}`, "playoffs.csv");
  const playoffs = existsSync(file) ? parseCsv(readFileSync(file, "utf8"), "playoffs.csv").rows : [];
  console.log(playoffWeekCount(seasonSlotRows(seedDir, season), playoffs, centralToday()));
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv.includes("--playoff-week")) playoffWeek();
