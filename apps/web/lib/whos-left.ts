// Who is still in a bracket, each team's next game and the road it has taken (ADR 0094), worked out from the bracket tree's
// boxes (app/playoffs/tree/data.ts) so the list can never disagree with the drawing above it. Pure, no imports: the page and
// the node tests run it as it is. Teams are told apart by `key` (a program's slug); a side with no key is a game's winner to
// come, a bye or "to be decided", never a team.

type Side = { key?: string; text: string; program?: string; score?: number; won?: boolean; bye?: true };
export type LeftBox = {
  id: string; label: string; code?: string; state: "final" | "disputed" | "upcoming" | "open" | "bye";
  sides: [Side, Side]; to?: string; date?: string; when?: string; time?: string; site?: string; href?: string; forfeit?: boolean;
};
/** The tree's data as far as this file reads it: the boxes, and the rounds first to last with the ids of their boxes. */
type LeftData = { boxes: LeftBox[]; rounds: { round: string; label: string; ids: string[] }[] };

/** The last round of every league's bracket, as the site words it (lib/brackets.ts roundLabel). */
const STATE_CHAMPIONSHIP = "State Championship";

type TeamStatus = {
  /** alive: still in; out: lost its last game; champion: won the State Championship. */
  state: "alive" | "out" | "champion";
  /** The boxes the team is in, earliest round first. */
  games: LeftBox[];
  /** The game it plays next: its last game when that is not yet a final, else the game its win goes on to, if the bracket has it. */
  next?: LeftBox;
};

const roundIndex = (data: LeftData) => new Map(data.rounds.flatMap((r, i) => r.ids.map((id) => [id, i] as const)));

/** Where one team stands. A disputed final names no winner (ADR 0040), so both teams stay in it, at that game. */
export function teamStatus(data: LeftData, key: string): TeamStatus | undefined {
  const at = roundIndex(data);
  const games = data.boxes.filter((b) => b.sides.some((s) => s.key === key)).sort((a, b) => (at.get(a.id) ?? 0) - (at.get(b.id) ?? 0));
  const tip = games.at(-1);
  if (!tip) return undefined;
  const byId = new Map(data.boxes.map((b) => [b.id, b]));
  const onward = tip.to ? byId.get(tip.to) : undefined;
  if (tip.state === "final") {
    if (!tip.sides.find((s) => s.key === key)?.won) return { state: "out", games };
    if (tip.label === STATE_CHAMPIONSHIP) return { state: "champion", games };
    return { state: "alive", games, ...(onward ? { next: onward } : {}) };
  }
  if (tip.state === "bye") return { state: "alive", games, ...(onward ? { next: onward } : {}) };
  return { state: "alive", games, next: tip };
}

export type Left = {
  key: string; name: string; program?: string; state: "alive" | "champion"; next?: LeftBox;
  /** The text of its State Championship chance ("12%"), when the site has one. */
  title?: string;
};

/**
 * The teams still in, most likely champion first (a team with no chance known after the rest, then by name). `titles`: each
 * team's chance to win the State Championship as the page words it, by key. A champion is listed alone at the top.
 */
export function whosLeft(data: LeftData, titles: Record<string, string> = {}, chances: Record<string, number> = {}): Left[] {
  const seen = new Map<string, Side>();
  for (const b of data.boxes) for (const s of b.sides) if (s.key && !seen.has(s.key)) seen.set(s.key, s);
  const out: Left[] = [];
  for (const [key, side] of seen) {
    const status = teamStatus(data, key);
    if (!status || status.state === "out") continue;
    out.push({ key, name: side.text, ...(side.program ? { program: side.program } : {}), state: status.state, ...(status.next ? { next: status.next } : {}), ...(titles[key] ? { title: titles[key] } : {}) });
  }
  const chance = (l: Left) => (l.state === "champion" ? 2 : chances[l.key] ?? -1);
  return out.sort((a, b) => chance(b) - chance(a) || a.name.localeCompare(b.name));
}

/** What a side reads as an opponent: the team, or the game whose winner it will be. */
const opponentOf = (box: LeftBox, key: string) => {
  const other = box.sides.find((s) => s.key !== key) ?? box.sides[1];
  return other.bye ? "a bye" : other.text;
};

/** One line of a team's road: "Bi-district: won 46-20 over Cedar Gap", "Area: Nov 20, 7:00 PM, against Hermleigh". A forfeit shows no score. */
export function stepText(box: LeftBox, key: string): string {
  const mine = box.sides.find((s) => s.key === key);
  const other = box.sides.find((s) => s !== mine);
  const vs = opponentOf(box, key);
  if (box.state === "bye") return `${box.label}: bye`;
  if (box.state === "final") {
    const won = mine?.won;
    if (box.forfeit) return `${box.label}: ${won ? "won by forfeit over" : "forfeited to"} ${vs}`;
    const score = mine?.score != null && other?.score != null ? ` ${mine.score}-${other.score}` : "";
    return `${box.label}: ${won ? "won" : "lost"}${score} ${won ? "over" : "to"} ${vs}`;
  }
  if (box.state === "disputed") return `${box.label}: result under review, against ${vs}`;
  const when = [box.when, box.time].filter(Boolean).join(", ") || "date not listed yet";
  return `${box.label}: ${when}, against ${vs}`;
}

type Step = { id: string; round: string; kind: "played" | "next" | "ahead"; text: string };

/** A team's whole road: the games it has played, the one it plays next, and each game its wins would lead to. */
export function pathSteps(data: LeftData, key: string): Step[] {
  const status = teamStatus(data, key);
  if (!status) return [];
  const at = roundIndex(data);
  const byId = new Map(data.boxes.map((b) => [b.id, b]));
  const round = (b: LeftBox) => data.rounds[at.get(b.id) ?? 0]?.round ?? "";
  const steps: Step[] = [];
  const done = new Set<string>();
  const add = (b: LeftBox, kind: Step["kind"]) => {
    if (done.has(b.id)) return;
    done.add(b.id);
    steps.push({ id: b.id, round: round(b), kind, text: stepText(b, key) });
  };
  for (const g of status.games) if (g.id !== status.next?.id) add(g, g.state === "final" || g.state === "bye" ? "played" : "next");
  if (status.next) add(status.next, "next");
  // The road ahead: each game the next one's winner would play, while the bracket has it.
  for (let b = status.state === "alive" && status.next ? byId.get(status.next.to ?? "") : undefined; b && !done.has(b.id); b = b.to ? byId.get(b.to) : undefined) {
    done.add(b.id);
    steps.push({ id: b.id, round: round(b), kind: "ahead", text: `${b.label}: if it advances` });
  }
  return steps.sort((a, b) => (data.rounds.findIndex((r) => r.round === a.round) - data.rounds.findIndex((r) => r.round === b.round)));
}

/** The weekday-and-date line of a game for a card: "Fri, Nov 20", from its Central date, or "Date not listed yet". */
export const dayLine = (iso: string | undefined) =>
  iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }) : "Date not listed yet";

/** The round to open on: the one the page names when the bracket has it, else the first with a game still to play, else the last. */
export function openRound(data: LeftData, named?: string): number {
  const i = data.rounds.findIndex((r) => r.round === named);
  if (i >= 0) return i;
  const open = data.rounds.findIndex((r) => r.ids.some((id) => ["upcoming", "open"].includes(data.boxes.find((b) => b.id === id)?.state ?? "")));
  return open < 0 ? data.rounds.length - 1 : open;
}
