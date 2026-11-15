// Next-round bracket games no listing has yet, for the morning kickoff read (ADR 0067): a league's own bracket file (UIL's
// data/seed/uil-<span>/bracket-<year>.csv, a robot-read data/seed/brackets/<year>.csv) filled with the season's finals,
// the same way the playoff pages fill it (apps/web/lib/bracket-fill.ts, ADR 0047). Only a pairing whose two teams are both
// set by winners is due; a side still waiting on a game is not. No date: the feed's kickoff gives it.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { builtGames, fill, ownSlots, ROUND_ORDER, uilSlotRows } from "../../apps/web/lib/bracket-fill.ts";
import { parseCsv } from "./store.mjs";

/** A playoffs.csv row as the bracket fill reads a game: a scored game is final (ADR 0013), a forfeit by its 1-0 or 2-0. */
export function fillGame(r) {
  const scored = r.home_score !== "" && r.away_score !== "";
  return {
    round: r.round, date: r.game_date, home: r.home, away: r.away, confirmed: scored,
    ...(scored ? { homeScore: Number(r.home_score), awayScore: Number(r.away_score) } : {}),
  };
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

/** The season's slot rows from the seed folder: UIL's own bracket files and the robot-read bracket file. */
export function seasonSlotRows(seedDir, season) {
  const read = (f, name) => (existsSync(f) ? parseCsv(readFileSync(f, "utf8"), name).rows : []);
  const uil = readdirSync(seedDir)
    .filter((d) => /^uil-\d{4}-\d{2}$/.test(d))
    .flatMap((d) => uilSlotRows(read(path.join(seedDir, d, `bracket-${season}.csv`), "UIL bracket")));
  return [...uil, ...read(path.join(seedDir, "brackets", `${season}.csv`), "bracket slots")];
}
