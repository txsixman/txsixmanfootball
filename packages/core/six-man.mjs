// Six-man score checks from plan Appendix B. Every flag is soft: real results include extreme outliers,
// so these warn a person and never block a score.

const MERCY_ENDS = new Set(["mercy_half", "mercy_2h"]);

export function scoreFlags({ home, away, endReason, periods }) {
  const flags = [];
  const margin = Math.abs(home - away);

  if (endReason !== "forfeit" && [home, away].some((s) => [1, 3, 5].includes(s))) flags.push("rare_score");
  if (margin >= 45 && !MERCY_ENDS.has(endReason) && !["forfeit", "unknown"].includes(endReason)) {
    flags.push("margin_45_without_mercy_end");
  }
  if (MERCY_ENDS.has(endReason) && margin < 45) flags.push("mercy_end_below_45");
  // The game stops the moment a 45-point lead is reached, so 44 plus one touchdown is the most it can be.
  if (endReason === "mercy_2h" && margin > 50) flags.push("second_half_margin_above_50");
  if (home + away >= 175) flags.push("extreme_total");
  if (periods?.length) {
    const sum = (side) => periods.reduce((total, p) => total + p[side], 0);
    if (sum("home") !== home || sum("away") !== away) flags.push("quarters_do_not_sum");
  }
  return flags;
}
