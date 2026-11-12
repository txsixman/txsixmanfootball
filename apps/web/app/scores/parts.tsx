import { CircleHelp, TriangleAlert } from "lucide-react";
import type { Game } from "@/lib/demo-games";
import type { Side } from "@/lib/score-display";

/** Weight says who won. The underline says how sure we are, so the number itself never reads as official. */
export function scoreClass(g: Game, lost: boolean): string {
  let cls = lost ? "font-semibold text-ink/70" : "font-bold text-ink";
  if (g.verification === "unconfirmed") cls += " underline decoration-dashed decoration-2 underline-offset-[5px]";
  if (g.verification === "disputed") cls += " underline decoration-wavy decoration-red decoration-2 underline-offset-[5px]";
  return cls;
}

/** W or L in a dashed box: a forfeit has no real score to show. */
export function ForfeitMark({ side, winner, large }: { side: Side; winner: Side; large?: boolean }) {
  const won = side === winner;
  const size = large ? "size-16 text-[40px]" : "size-7 text-[20px]";
  return (
    <span className={`inline-flex items-center justify-center border-2 border-dashed border-muted font-num font-bold leading-none text-ink ${size}`}>
      <span aria-hidden="true">{won ? "W" : "L"}</span>
      <span className="sr-only">{won ? "forfeit win" : "forfeit loss"}</span>
    </span>
  );
}

/** Full-width words for the two states a reader must never miss. */
export function VerifyBar({ g }: { g: Game }) {
  if (g.verification === "disputed") {
    return (
      <p className="flex items-center gap-2 bg-red px-3 py-1.5 text-[13px] leading-4 text-white">
        <TriangleAlert aria-hidden="true" className="size-4 shrink-0" strokeWidth={2.5} />
        <span>
          <b className="mr-1.5 font-num text-[16px] uppercase tracking-wide">Disputed</b>
          {g.sources ? `${g.sources}. ` : ""}No winner marked.
        </span>
      </p>
    );
  }
  if (g.verification === "unconfirmed") {
    return (
      <p className="flex items-center gap-2 border-t-2 border-dashed border-red px-3 py-1 text-[13px] leading-4 text-red">
        <CircleHelp aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={2.5} />
        <span>
          <b className="mr-1.5 font-num text-[15px] uppercase tracking-wide">Unconfirmed</b>
          {g.sources ? `${g.sources}. ` : ""}Score may change.
        </span>
      </p>
    );
  }
  return null;
}
