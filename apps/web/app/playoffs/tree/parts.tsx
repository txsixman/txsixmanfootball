import type { LiveView } from "@/lib/live-scores";
import type { Box, BoxSide } from "./data";
import { boxLines } from "./lines";

// The pieces of a bracket box the whole tree and the round cards share (ADR 0049, ADR 0094).

/** The two lines under the teams: a game under way says so, unconfirmed (ADR 0021). */
export function footer(b: Box, live: LiveView | null, max: number): [string, string] {
  if (live) return live.finished ? ["Final · Unconfirmed", ""] : [["Live", live.period].filter(Boolean).join(" · "), "Unconfirmed"];
  return boxLines(b, max);
}

/** The first footer line's look: a final reads FINAL in bold navy (confirmed, ADR 0040; never a winner named); a game under way
 * is red; a projection navy; anything else muted. */
export const footClass = (box: Box, live: LiveView | null) =>
  live ? "font-bold text-red" : box.state === "final" && !box.forfeit ? "font-bold uppercase tracking-wide text-navy" : box.projection ? "font-semibold text-navy" : "text-muted";

export function SideRow({ side, other, live, lit, onTeam, tag }: { side: BoxSide; other: BoxSide; live?: number; lit: boolean; onTeam: (key: string) => void; tag?: string }) {
  const right = live ?? side.score ?? side.chance;
  const lost = other.won && !side.won;
  const text = (
    <>
      <span className={side.won ? "bx-won" : lost ? "bx-lost" : "bx-name"}>{side.text}</span>
      {/* At the right: the score or chance, and under it Home or Away (12px uppercase, an eyebrow label). Beside the name, so a
          name of three lines is as tall as it was. */}
      {(right != null || tag) && (
        <span className="flex shrink-0 flex-col items-end">
          {right != null && (
            <span className={typeof right === "string" ? "bx-chance" : live != null ? "bx-live" : "bx-score"}>
              {right}
            </span>
          )}
          {tag && <span className="bx-tag tracking-wider">{tag}</span>}
        </span>
      )}
    </>
  );
  if (side.projected) return <ProjectedRow side={side} projected={side.projected} />;
  if (!side.key) {
    return <span title={side.title ?? side.text} className={`relative flex h-11 items-center gap-1 px-1.5 text-[13px] ${side.bye ? "text-muted" : "italic text-muted"}`}>{text}</span>;
  }
  return (
    <button
      type="button"
      title={side.text}
      aria-pressed={lit}
      onClick={() => onTeam(side.key!)}
      className={lit ? "bx-side bg-panel" : "bx-side"}
    >
      {text}
    </button>
  );
}

/** A side no game sets yet (ADR 0071): its most likely team, muted and marked "Projected", inside a dashed outline, so it
 * never reads as a pairing. The game it waits on ("Winner of G17") is in its title. */
function ProjectedRow({ side, projected }: { side: BoxSide; projected: NonNullable<BoxSide["projected"]> }) {
  const said = "team" in projected ? `Projected: ${projected.team} · ${projected.chance}` : "Not enough games to project";
  return (
    <span data-projected title={`${side.title ?? side.text}. ${said}. A projection, not a result.`} className="relative mx-0.5 flex h-11 flex-col justify-center border border-dashed border-line px-1 text-[13px] text-muted">
      {"team" in projected ? (
        <>
          <span className="flex items-center justify-between gap-1 text-[11px] font-semibold uppercase leading-[12px] tracking-wider">
            Projected{" "}<span className="font-num tabular-nums">{projected.chance}</span>
          </span>
          {/* A space between the lines, for the text of a hidden round (a panel not open reads as one run of text). */}
          {" "}
          <span className="min-w-0 break-words italic leading-[15px]">{projected.team}</span>
        </>
      ) : (
        <span className="min-w-0 break-words italic leading-[15px]">Not enough games to project</span>
      )}
    </span>
  );
}

