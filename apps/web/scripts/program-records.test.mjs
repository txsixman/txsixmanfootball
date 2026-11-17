// A program's all-time numbers and records (lib/program-records.ts, ADR 0089).   node --test apps/web/scripts/
import assert from "node:assert/strict";
import { test } from "node:test";
import { seasonLine } from "../lib/program-history.ts";
import { bestSeason, biggestLoss, biggestWin, longestWinStreak, programTotals, stateSummary, winShare, yearSpans } from "../lib/program-records.ts";

const game = (season, date, us, them, extra = {}) => ({ opponent: "Roby", date, us, them, forfeit: false, season, href: `/scores/${date}`, playoff: false, ...extra });
const line = (season, won, lost, extra = {}) =>
  seasonLine({ season, row: { won, lost, tied: 0, rating: 10 }, meetings: [], of: 40, ...extra });

test("biggestWin and biggestLoss: the widest margin, a forfeit never; a tie goes to more points, then the later game", () => {
  const games = [
    game(2021, "2021-09-03", 40, 6), // +34
    game(2022, "2022-09-02", 62, 28), // +34, more points
    game(2023, "2023-09-01", 2, 0, { forfeit: true }), // a forfeit has no margin
    game(2023, "2023-09-08", 14, 20),
    game(2024, "2024-09-06", 0, 45),
    game(2025, "2025-09-05", 0, 45), // the same loss, later
  ];
  assert.equal(biggestWin(games).date, "2022-09-02");
  assert.equal(biggestLoss(games).date, "2025-09-05");
  assert.equal(biggestWin([game(2023, "2023-09-01", 2, 0, { forfeit: true })]), undefined);
  assert.equal(biggestLoss([game(2023, "2023-09-01", 30, 0)]), undefined);
  assert.equal(biggestWin([]), undefined);
});

test("longestWinStreak: wins in a row across seasons; a loss, a tie or a read season with no game ends a run; a forfeit counts", () => {
  const seasons = [2021, 2022, 2023, 2024];
  const across = [
    game(2021, "2021-10-01", 7, 0), game(2021, "2021-10-08", 7, 0), game(2021, "2021-10-15", 2, 0, { forfeit: true }),
    game(2022, "2022-09-02", 7, 0), game(2022, "2022-09-09", 0, 7), // 4 wins, then a loss
    game(2022, "2022-09-16", 7, 0), game(2022, "2022-09-23", 7, 7), // a tie ends a run of 1
    game(2024, "2024-09-06", 7, 0), game(2024, "2024-09-13", 7, 0), // 2023 is read but has no game: the run starts over
  ];
  const s = longestWinStreak(across, seasons);
  assert.equal(s.wins, 4);
  assert.equal(s.from.date, "2021-10-01");
  assert.equal(s.to.date, "2022-09-02");
  assert.equal(s.current, false);
  // The run that is still going: nothing ended it and the program played in the latest season read.
  const going = longestWinStreak([game(2023, "2023-09-01", 1, 0), game(2024, "2024-09-06", 7, 0), game(2024, "2024-09-13", 7, 0)], seasons);
  assert.deepEqual([going.wins, going.current], [3, true]);
  // A later run of the same length wins the tie; one win is no streak.
  assert.equal(longestWinStreak([game(2021, "2021-09-01", 7, 0), game(2021, "2021-09-08", 7, 0), game(2021, "2021-09-15", 0, 7), game(2021, "2021-09-22", 7, 0), game(2021, "2021-09-29", 7, 0)], [2021]).from.date, "2021-09-22");
  assert.equal(longestWinStreak([game(2021, "2021-09-01", 7, 0), game(2021, "2021-09-08", 0, 7)], [2021]), undefined);
  assert.equal(longestWinStreak([], [2021]), undefined);
});

test("bestSeason: the best share of games won among completed seasons of six games or more", () => {
  const lines = [
    line(2026, 9, 0), // under way: skipped
    line(2025, 11, 1),
    line(2024, 10, 0),
    line(2023, 5, 0), // too short a season
    line(2022, 12, 0), // the same share as 2024 with more wins
    seasonLine({ season: 2021, row: { won: 0, lost: 0, tied: 0, rating: -45, rated: 0, rated_outside: 3 }, meetings: [], of: 40 }), // rated from outside games only: no record
    seasonLine({ season: 2020, meetings: [], of: 40 }), // nothing at all
  ];
  assert.equal(bestSeason(lines, 2026).season, 2022);
  assert.equal(bestSeason(lines.slice(0, 1), 2026), undefined);
  assert.equal(bestSeason([], 2026), undefined);
  // The latest season takes a tie in share and wins.
  assert.equal(bestSeason([line(2022, 10, 0), line(2024, 10, 0)]).season, 2024);
  assert.equal(winShare({ won: 3, lost: 1, tied: 2 }), 4 / 6);
  assert.equal(winShare({ won: 0, lost: 0, tied: 0 }), 0);
});

test("programTotals: the record, playoff seasons and playoff record over seasons that hold a record; a dash season adds nothing", () => {
  const playoff = { round: "regional", league: "UIL" };
  const lines = [
    line(2025, 12, 1, { playoff, playoffGames: [{ us: 40, them: 6 }, { us: 21, them: 24 }] }),
    line(2024, 10, 2, { playoff, playoffGames: [{ us: 1, them: 0 }] }),
    line(2023, 5, 5),
    seasonLine({ season: 2022, meetings: [], of: 40 }),
  ];
  assert.deepEqual(programTotals(lines), {
    seasons: 3, first: 2023, last: 2025,
    record: { won: 27, lost: 8, tied: 0 },
    playoffSeasons: 2, playoffRecord: { won: 2, lost: 1, tied: 0 },
  });
  assert.equal(programTotals([seasonLine({ season: 2022, meetings: [], of: 40 })]), undefined);
  assert.equal(programTotals([]), undefined);
});

test("stateSummary: games, titles and runner-up finishes with their years, newest first", () => {
  assert.deepEqual(stateSummary([{ season: 1984, won: true }, { season: 2019, won: false }, { season: 2022, won: true }, { season: 2023, won: true }]), {
    games: 4, titles: [2023, 2022, 1984], runnerUp: [2019],
  });
  assert.deepEqual(stateSummary([]), { games: 0, titles: [], runnerUp: [] });
});

test("yearSpans joins consecutive years and names the rest", () => {
  assert.equal(yearSpans([2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025]), "2018 to 2025");
  assert.equal(yearSpans([2023, 2018, 2019, 2021]), "2018 and 2019, 2021, 2023");
  assert.equal(yearSpans([2020, 2018, 2019, 2024, 2020]), "2018 to 2020, 2024");
  assert.equal(yearSpans([]), "");
});
