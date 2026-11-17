// What a share image says, and the alt text that describes it (ADR 0093). Pure, two local imports: the node tests run it as it is
// (scripts/share-text.test.mjs). The drawing is app/share-card.tsx and the three routes that use it.
//
// Every card is drawn at build time from the static data, so it reflects the last deploy and never a live score. A card never
// names a winner of a game that is not a confirmed final (ADR 0004, ADR 0040), never shows a forfeit's score, and says
// "State Championship" for the last round. Records are written out in words in alt text (a bare "1-0" reads as a forfeit score).

import { championBanner } from "../app/scores/[id]/card/state-card.ts";
import { kickoffTime } from "./kickoff.ts";

/** "Fri, Nov 20". */
const dayLabel = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

/** "Friday, November 20, 2026". */
const fullDay = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

const plural = (n: string, one: string, many: string) => `${n} ${n === "1" ? one : many}`;

/** "7-2" or "7-2-1" in words: "7 wins and 2 losses". Anything else comes back as it is. */
export function recordInWords(record: string): string {
  const found = /^(\d+)-(\d+)(?:-(\d+))?$/.exec(record);
  if (!found) return record;
  const parts = [plural(found[1], "win", "wins"), plural(found[2], "loss", "losses"), ...(found[3] ? [plural(found[3], "tie", "ties")] : [])];
  return parts.length === 2 ? parts.join(" and ") : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

/** "38-14" as "38 to 14", for alt text. */
const scoreInWords = (score: string) => score.replace(/^(\d+)-(\d+)$/, "$1 to $2");

/** A site the data does not know yet is left off the card ("Site not listed yet", "Neutral site or not listed"). */
const knownSite = (site?: string) => (site && !/not listed/i.test(site) ? site.replace(/ \(home\)$/, "") : undefined);

/** The day and kickoff of a game still to play: "Fri, Nov 20 · 7:00 PM CT"; the time left off when it is not listed yet. */
function when(date?: string, kickoff?: string): string | undefined {
  if (!date) return undefined;
  const time = kickoff && !Number.isNaN(Date.parse(kickoff)) ? kickoffTime(kickoff) : undefined;
  return time ? `${dayLabel(date)} · ${time}` : dayLabel(date);
}

/** "Friday, November 20, 2026 at 7:00 PM CT, at Pine Bowl" for alt text; each part only when it is known. */
function whereAndWhen(date?: string, kickoff?: string, site?: string): string {
  const time = kickoff && !Number.isNaN(Date.parse(kickoff)) ? kickoffTime(kickoff) : undefined;
  return [date ? `${fullDay(date)}${time ? ` at ${time}` : ""}` : "date not listed yet", site && `at ${site}`].filter(Boolean).join(", ");
}

/** The top line's size in px. `alone`: no date shares the line (a game still to play), so it can be larger. A long State
 * Championship title steps down so it stays on one line. */
export const kickerSize = (kicker: string, alone: boolean) =>
  alone ? (kicker.length > 46 ? 30 : kicker.length > 36 ? 38 : 44) : kicker.length > 46 ? 24 : kicker.length > 36 ? 28 : 34;

/** A side the bracket has not settled yet reads "Winner of G29" there; a card never says "winner" (a game page may be live), so the
 * image says "To be decided (game 29)" and the alt text "the team that wins game 29". A known team is its own name in both. */
function sideWords(side: { text: string; known: boolean }): { label: string; alt: string } {
  if (side.known) return { label: side.text, alt: side.text };
  const token = /^Winner of (.+)$/.exec(side.text)?.[1];
  if (!token) return { label: "To be decided", alt: "a team to be decided" };
  const game = token.replace(/^G(\d+)$/, "game $1").replace(/^SF(\d+)$/, "semifinal $1");
  return { label: `To be decided (${game})`, alt: `the team that wins ${game}` };
}

const sentence = (parts: (string | undefined | false)[]) => parts.filter(Boolean).join(" ");

type GameCardSide = { name: string; score: number | null; record?: string };
type GameCardInput = {
  /** The round and season line ("UIL Division I · Quarterfinal"), or a State Championship's title. */
  kicker: string;
  date?: string;
  kickoff?: string;
  site?: string;
  state: "live" | "final" | "scheduled" | "postponed";
  forfeit: boolean;
  /** The sources agree on the final (ADR 0040). */
  confirmed: boolean;
  away: GameCardSide;
  home: GameCardSide;
  /** "Pinecrest Academy · State Champion", once a State Championship is recorded and confirmed. */
  banner?: string;
};
type GameCardText = {
  /** The footer's word: "Final", "Score reported", "Forfeit", "Postponed", "Scheduled". */
  status: string;
  /** The scores are on the card: a played final that is not a forfeit. */
  scores: boolean;
  /** A game still to play shows its day, time and site, and each team's record. */
  upcoming: boolean;
  when?: string;
  site?: string;
  records: { away?: string; home?: string };
  alt: string;
};

/** What a game page's card says. A final shows both scores; a game still to play shows its matchup, day, time, site and records. */
export function gameCardText(g: GameCardInput): GameCardText {
  const scores = g.state === "final" && !g.forfeit && g.away.score != null && g.home.score != null;
  const status = g.forfeit ? "Forfeit" : scores ? (g.confirmed ? "Final" : "Score reported") : g.state === "postponed" ? "Postponed" : g.state === "live" ? "In progress" : "Scheduled";
  const upcoming = g.state !== "final";
  const records = upcoming ? { away: g.away.record || undefined, home: g.home.record || undefined } : {};
  const day = upcoming ? when(g.date, g.kickoff) : undefined;
  const site = upcoming ? knownSite(g.site) : undefined;
  const matchup = `${g.away.name} versus ${g.home.name}`;
  const date = g.date && fullDay(g.date);
  let alt: string;
  if (scores) {
    const result = `${g.away.name} ${g.away.score}, ${g.home.name} ${g.home.score}`;
    alt = sentence([`${status === "Final" ? "Final score" : "Score reported, not confirmed"}, ${g.kicker}${date ? `, ${date}` : ""}: ${result}.`, g.banner && `${g.banner}.`]);
  } else if (g.forfeit) {
    alt = sentence([`${g.kicker}${date ? `, ${date}` : ""}: ${matchup}, a forfeit. No score was played.`]);
  } else {
    const have = [records.away && `${g.away.name} ${recordInWords(records.away)}`, records.home && `${g.home.name} ${recordInWords(records.home)}`].filter(Boolean);
    alt = sentence([`${status}, ${g.kicker}: ${matchup}, ${whereAndWhen(g.date, g.kickoff, site)}.`, have.length > 0 && `Records: ${have.join("; ")}.`]);
  }
  return { status, scores, upcoming, ...(day && { when: day }), ...(site && { site }), records, alt };
}

type ProgramCardInput = {
  name: string;
  mascot?: string | null;
  /** "UIL Division I". */
  group: string;
  /** "Region 2 · District 5", or empty. */
  place: string;
  season: number;
  /** The rank's text as the program page shows it ("#3 in Division I", "Not ranked"). */
  rank?: string;
  /** This season's record ("7-2"). */
  record?: string;
  /** The latest game with a score: `score` is "38-14" (this school's first) or "Forfeit"; `versus` "vs Kress" or "at Kress". */
  latest?: { score: string; versus: string };
};
type ProgramCardText = {
  kicker: string;
  /** "2026 · #3 in Division I · 7-2". */
  standing?: string;
  /** "Latest score: 38-14 vs Kress". No winner is named: a robot-read score may not be confirmed (ADR 0004). */
  latest?: string;
  alt: string;
};

/** What a program page's card says: the school, its place, this season's record and rank, and its latest result. */
export function programCardText(p: ProgramCardInput): ProgramCardText {
  const kicker = p.place && p.place !== p.group ? `${p.group} · ${p.place}` : p.group;
  const standing = p.rank && p.record ? `${p.season} · ${p.rank} · ${p.record}` : undefined;
  const latest = p.latest && (p.latest.score === "Forfeit" ? `Latest game: forfeit ${p.latest.versus}` : `Latest score: ${p.latest.score} ${p.latest.versus}`);
  const rank = p.rank && (/^#(\d+) in (.+)$/.exec(p.rank) ? `ranked ${p.rank.replace(/^#(\d+) in /, "number $1 in ")}` : "not yet ranked");
  const alt = sentence([
    `${p.name}${p.mascot ? ` ${p.mascot}` : ""} football, ${kicker}.`,
    standing && `${p.season}: ${rank}, ${recordInWords(p.record!)}.`,
    p.latest && (p.latest.score === "Forfeit" ? `Latest game: a forfeit ${p.latest.versus}.` : `Latest score: ${scoreInWords(p.latest.score)} ${p.latest.versus}.`),
  ]);
  return { kicker, ...(standing && { standing }), ...(latest && { latest }), alt };
}

type ChampionshipCardInput = {
  /** "2026 UIL Division I State Championship". */
  title: string;
  /** Home (the bracket's first side) first. `text` reads "Winner of G29" while a side is open. */
  sides: [{ text: string; known: boolean; record?: string }, { text: string; known: boolean; record?: string }];
  date?: string;
  kickoff?: string;
  site?: string;
  /** Played and recorded: the champion, and the scores unless it was a forfeit (ADR 0083). */
  final?: { champion: string; runnerUp: string; championScore?: number; runnerUpScore?: number; forfeit: boolean };
  /** The listed scores of a played game, home first, recorded or not. */
  scores?: [number, number];
};
type ChampionshipCardText = {
  title: string;
  /** "Pinecrest Academy · State Champion", only for a recorded, confirmed final. */
  banner?: string;
  /** What the image calls each side: the team's name, or "To be decided (game 29)" for a side not settled yet. */
  names: [string, string];
  /** Each side's score, shown only when the game is played and the score may be shown. */
  shown: [number | null, number | null];
  /** Each side's season record, for a game still to play. */
  records: [string | undefined, string | undefined];
  footer: string;
  when?: string;
  site?: string;
  alt: string;
};

/** What a State Championship page's card says: the matchup before the game; the champion and score once recorded; the listed
 * score with no champion while the result is not confirmed (ADR 0040); a forfeit's winner with no score. */
export function championshipCardText(c: ChampionshipCardInput): ChampionshipCardText {
  const [a, b] = c.sides;
  const [wa, wb] = [sideWords(a), sideWords(b)];
  const banner = championBanner(c.final);
  // The score: the recorded final's (never a forfeit's), else the listed one of a played game.
  const shown: [number | null, number | null] = c.final
    ? c.final.forfeit
      ? [null, null]
      : a.text === c.final.champion
        ? [c.final.championScore ?? null, c.final.runnerUpScore ?? null]
        : [c.final.runnerUpScore ?? null, c.final.championScore ?? null]
    : (c.scores ?? [null, null]);
  const played = c.final !== undefined || c.scores !== undefined;
  const footer = c.final ? (c.final.forfeit ? "Forfeit" : "Final") : c.scores ? "Score reported" : "Scheduled";
  const day = played ? undefined : when(c.date, c.kickoff);
  const site = played ? undefined : knownSite(c.site);
  const date = c.date && fullDay(c.date);
  let alt: string;
  if (c.final) {
    const score = c.final.forfeit ? "A forfeit, no score was played" : `Final score ${scoreInWords(`${c.final.championScore}-${c.final.runnerUpScore}`)}`;
    alt = sentence([`${c.title}: ${c.final.champion}, State Champion.`, `${score} over ${c.final.runnerUp}${date ? `, ${date}` : ""}.`]);
  } else if (c.scores) {
    alt = `${c.title}, score reported, not confirmed: ${wa.alt} ${c.scores[0]}, ${wb.alt} ${c.scores[1]}. No champion is named yet.`;
  } else {
    const have = [a.record && `${wa.alt} ${recordInWords(a.record)}`, b.record && `${wb.alt} ${recordInWords(b.record)}`].filter(Boolean);
    alt = sentence([`${c.title}: ${wa.alt} versus ${wb.alt}, ${whereAndWhen(c.date, c.kickoff, site)}.`, have.length > 0 && `Records: ${have.join("; ")}.`]);
  }
  return { title: c.title, ...(banner && { banner }), names: [wa.label, wb.label], shown, records: played ? [undefined, undefined] : [a.record, b.record], footer, ...(day && { when: day }), ...(site && { site }), alt };
}
