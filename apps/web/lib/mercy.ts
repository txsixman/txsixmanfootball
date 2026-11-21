// How the site names a game ended by a big lead: one phrase, "45-point rule", wherever a page or a data note says it.
// A six-man game stops once one team leads by 45 points at halftime or later (plan Appendix B, packages/core/six-man.mjs).

export const MERCY_RULE = "45-point rule";

/** The end-of-game note for a game ended by the rule: "45-point rule, halftime", "45-point rule, Q3", or with no period
 * "45-point rule, second half". `period` is the quarter ("3") when the game was stopped in the second half. */
export function ruleEnd(code: "mercy_half" | "mercy_2h", period = ""): string {
  if (code === "mercy_half") return `${MERCY_RULE}, halftime`;
  return period ? `${MERCY_RULE}, Q${period}` : `${MERCY_RULE}, second half`;
}

/** A state final's own note as the archive words it ("Mercy Rule 3Q", "Mercy Rule-Halftime", "Mercy Rule-9:45 3rd Quarter")
 * said the way game pages say it ("45-point rule, Q3", "45-point rule, halftime", "45-point rule, Q3 9:45"). Any other note
 * ("OT", "Forfeit") is returned as it is. */
export function archiveNote(note: string): string {
  const m = /^mercy rule\s*[-:]?\s*(.*)$/i.exec(note.trim());
  if (!m) return note;
  const rest = m[1].trim();
  if (!rest) return MERCY_RULE;
  const quarter = /^(\d)Q$/i.exec(rest) ?? /^(?:Q)(\d)$/i.exec(rest);
  if (quarter) return `${MERCY_RULE}, Q${quarter[1]}`;
  const clock = /^(\d{1,2}:\d{2})\s+(\d)(?:st|nd|rd|th)\s+quarter$/i.exec(rest);
  if (clock) return `${MERCY_RULE}, Q${clock[2]} ${clock[1]}`;
  return `${MERCY_RULE}, ${rest.charAt(0).toLowerCase()}${rest.slice(1)}`;
}
