import { ownSlots, ROUND_ORDER, type FillGame, type SlotRow } from "./bracket-fill";
import { treeGames } from "./bracket-tree";
import { roundLabel } from "./brackets";
import sample from "./demo-ratings.json";
import { project } from "./projection";
import type { RatingsTable } from "./ratings";

// An invented bracket for the sample page (/playoffs/bracket/sample) and its screenshot test: every kind of box the tree
// view draws, among invented schools only (the same ones as the sample rankings). Never real schools: a made-up score
// beside a real team reads as a real result.

const rows: [string, string, string, string, string][] = [
  ["1", "round-1", "G1", "Red Bluff Creek", "Cedar Gap"],
  ["1", "round-1", "G2", "Stillwater Draw", "Caprock"],
  ["2", "round-1", "G3", "Windmill Christian", "Lone Post"],
  ["2", "round-1", "G4", "Mesquite Flat", "Pecan Valley"],
  ["3", "round-1", "G5", "Dry Wash", "Bluestem"],
  ["3", "round-1", "G6", "Hackberry", "Live Oak Springs"],
  ["4", "round-1", "G7", "Sandy Ford", "Oak Chapel Academy"],
  ["4", "round-1", "G8", "North Fence", "bye"],
  ["", "quarterfinal", "G9", "winner:G1", "winner:G2"],
  ["", "quarterfinal", "G10", "winner:G3", "winner:G4"],
  ["", "quarterfinal", "G11", "winner:G5", "winner:G6"],
  ["", "quarterfinal", "G12", "winner:G7", "winner:G8"],
  ["", "semifinal", "G13", "winner:G9", "winner:G10"],
  ["", "semifinal", "G14", "winner:G11", "winner:G12"],
  ["", "final", "G15", "winner:G13", "winner:G14"],
];
const slotRows: SlotRow[] = rows.map(([region, round, slot, a, b]) => ({ league: "Sample", division: "1", round, slot, a, b, ...(region ? { region } : {}) }));

const played = (date: string, home: string, away: string, homeScore: number, awayScore: number, extra: Partial<FillGame> = {}): FillGame => ({ round: "round-1", date, home, away, homeScore, awayScore, confirmed: true, ...extra });
const games: FillGame[] = [
  played("2026-11-13", "Red Bluff Creek", "Cedar Gap", 46, 20),
  played("2026-11-13", "Stillwater Draw", "Caprock", 52, 50),
  played("2026-11-12", "Windmill Christian", "Lone Post", 1, 0, { forfeit: true }),
  played("2026-11-13", "Mesquite Flat", "Pecan Valley", 38, 36, { confirmed: false }), // the sources disagree: no winner
  played("2026-11-13", "Dry Wash", "Bluestem", 60, 14),
  { round: "round-1", date: "2026-11-14", home: "Hackberry", away: "Live Oak Springs", confirmed: false },
  played("2026-11-13", "Sandy Ford", "Oak Chapel Academy", 30, 28),
  { round: "quarterfinal", date: "2026-11-20", home: "Red Bluff Creek", away: "Stillwater Draw", confirmed: false },
];

/** Kickoffs and sites the sample lists, by game. */
export const DEMO_INFO: Record<string, { kickoff?: string; site?: string }> = {
  G6: { kickoff: "2026-11-15T00:00:00Z", site: "Midway Field, Midway" },
  G9: { kickoff: "2026-11-21T01:00:00Z", site: "Caprock Stadium, Caprock" },
};

export function demoTree() {
  const table = sample as RatingsTable;
  return treeGames(ownSlots(slotRows, { league: "Sample", division: "1" }), games, ROUND_ORDER).map((n) => {
    const [a, b] = n.sides;
    const projection = (n.state === "upcoming" || n.state === "open") && a.team && b.team ? project(table, a.team, b.team, true, true) : undefined;
    return { ...n, label: roundLabel(n.round, "Sample"), ...(projection ? { projection } : {}) };
  });
}
