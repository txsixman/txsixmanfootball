// Invented schools and scores for design work. Never use real schools here: a made-up score next to a real team
// reads as a real result.

export type Team = {
  name: string;
  mascot: string;
  initials: string;
  color: string;
  record: string;
  rank?: number;
};

export type Game = {
  id: string;
  /** ISO date, for captured games. */
  date?: string;
  /** The bracket round token ("bi-district", "semifinal", ...) of a captured playoff game; the invented sample games have none. */
  round?: string;
  league: string;
  home: Team;
  away: Team;
  homeScore: number | null;
  awayScore: number | null;
  state: "live" | "final" | "scheduled" | "postponed";
  /** Short status as it should read: "Q3 4:12", "Halftime", "Final", "7:30 PM". */
  status: string;
  /** Kickoff in UTC, for a game not yet played, when known (lib/kickoffs.ts, ADR 0036). */
  kickoff?: string;
  /** Why it ended, when that matters: "45-point rule, halftime", "Forfeit". */
  endReason?: string;
  verification: "confirmed" | "unconfirmed" | "disputed" | "none";
  /** "2 sources: reporter, coach". */
  sources?: string;
  projected?: string;
  /** The projected margin in points, for ordering games by how close they look. */
  projectedMargin?: number;
  upset?: boolean;
  stream?: string;
  venue: string;
  quarters?: { home: number[]; away: number[] };
};

const t = (name: string, mascot: string, initials: string, color: string, record: string, rank?: number): Team => ({
  name, mascot, initials, color, record, rank,
});

const cedarGap = t("Cedar Gap", "Rams", "CG", "#7a1f2b", "9-1", 3);
const mesquiteFlat = t("Mesquite Flat", "Coyotes", "MF", "#1f5f8b", "7-3");
const redBluff = t("Red Bluff Creek", "Longhorns", "RB", "#a4501a", "10-0", 1);
const saltFork = t("Salt Fork", "Mustangs", "SF", "#2e6b3f", "2-8");
const pecanValley = t("Pecan Valley", "Eagles", "PV", "#4a2d7a", "8-2", 6);
const dryWash = t("Dry Wash", "Bobcats", "DW", "#111827", "6-4");
const lonePost = t("Lone Post", "Panthers", "LP", "#0f6e6e", "5-5");
const hackberry = t("Hackberry", "Wildcats", "HB", "#a01c5a", "4-6");
const stillwater = t("Stillwater Draw", "Hornets", "SD", "#8a6a12", "9-1", 4);
const northFence = t("North Fence", "Broncos", "NF", "#23407a", "3-7");
const windmill = t("Windmill Christian", "Crusaders", "WC", "#5b2333", "7-2");
const oakChapel = t("Oak Chapel Academy", "Saints", "OC", "#355e3b", "6-3");
const caprock = t("Caprock", "Bulldogs", "CR", "#6b3a1e", "8-2", 8);
const bluestem = t("Bluestem", "Tigers", "BS", "#b4531a", "5-5");
const sandyFord = t("Sandy Ford", "Cowboys", "SA", "#32507a", "1-9");
const liveOak = t("Live Oak Springs", "Falcons", "LO", "#5c6b1f", "6-4");

export const demoGames: Game[] = [
  {
    id: "g1", league: "UIL DI · Bi-District", home: cedarGap, away: mesquiteFlat, homeScore: 48, awayScore: 42,
    state: "live", status: "Q3 4:12", verification: "confirmed", sources: "Reporter, live", projected: "Cedar Gap by 11",
    stream: "Local radio", venue: "Ram Field, Cedar Gap",
    quarters: { home: [14, 20, 14, 0], away: [22, 8, 12, 0] },
  },
  {
    id: "g2", league: "UIL DII · Bi-District", home: redBluff, away: saltFork, homeScore: 52, awayScore: 0,
    state: "final", status: "Final", endReason: "45-point rule, halftime", verification: "confirmed",
    sources: "2 sources: reporter, coach", projected: "Red Bluff Creek by 45+", venue: "Longhorn Stadium, Red Bluff Creek",
    quarters: { home: [28, 24, 0, 0], away: [0, 0, 0, 0] },
  },
  {
    id: "g3", league: "UIL DI · Bi-District", home: pecanValley, away: dryWash, homeScore: 72, awayScore: 66,
    state: "final", status: "Final", verification: "unconfirmed", sources: "1 source: fan report",
    projected: "Pecan Valley by 9", venue: "Eagle Field, Pecan Valley",
    quarters: { home: [20, 16, 18, 18], away: [14, 22, 14, 16] },
  },
  {
    id: "g4", league: "UIL DII · Bi-District", home: lonePost, away: stillwater, homeScore: 38, awayScore: 34,
    state: "final", status: "Final", verification: "confirmed", sources: "2 sources: coach, reporter", upset: true,
    projected: "Stillwater Draw by 18", venue: "Panther Field, Lone Post",
    quarters: { home: [8, 14, 8, 8], away: [12, 6, 8, 8] },
  },
  {
    id: "g5", league: "UIL DI · Bi-District", home: hackberry, away: northFence, homeScore: 22, awayScore: 20,
    state: "live", status: "Halftime", verification: "unconfirmed", sources: "1 source: text-in",
    projected: "Hackberry by 3", stream: "YouTube", venue: "Wildcat Field, Hackberry",
    quarters: { home: [8, 14, 0, 0], away: [14, 6, 0, 0] },
  },
  {
    id: "g6", league: "TAPPS DII · Semifinal", home: windmill, away: oakChapel, homeScore: 1, awayScore: 0,
    state: "final", status: "Final", endReason: "Forfeit", verification: "confirmed", sources: "League notice",
    venue: "Crusader Field, Windmill",
  },
  {
    id: "g7", league: "UIL DII · Bi-District", home: caprock, away: bluestem, homeScore: 60, awayScore: 14,
    state: "final", status: "Final", endReason: "45-point rule, Q3 2:40", verification: "disputed",
    sources: "2 reports disagree", projected: "Caprock by 31", venue: "Bulldog Field, Caprock",
    quarters: { home: [22, 20, 18, 0], away: [8, 6, 0, 0] },
  },
  {
    id: "g8", league: "UIL DI · Bi-District", home: sandyFord, away: liveOak, homeScore: null, awayScore: null,
    state: "scheduled", status: "7:30 PM", verification: "none", projected: "Live Oak Springs by 21",
    stream: "YouTube", venue: "Cowboy Field, Sandy Ford",
  },
  {
    id: "g9", league: "TAPPS DI · Semifinal", home: oakChapel, away: bluestem, homeScore: null, awayScore: null,
    state: "postponed", status: "Postponed", endReason: "Lightning, moved to Sat 1:00 PM", verification: "none",
    venue: "Saints Field, Oak Chapel",
  },
];
