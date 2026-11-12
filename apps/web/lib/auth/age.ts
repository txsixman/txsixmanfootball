// The age gate's arithmetic, the same as create_profile() in migration 0011 (the database decides; this only lets the
// form ask the 13th-birthday question and refuse early). No imports, so the node tests run it as it is.

/** The calendar year in Texas (America/Chicago), the clock create_profile() uses. */
export function currentYear(now: Date = new Date()): number {
  return Number(new Intl.DateTimeFormat("en-US", { year: "numeric", timeZone: "America/Chicago" }).format(now));
}

/**
 * What sign-up does with a birth year:
 * - "ok": 14 to 120 years back, nothing to ask.
 * - "ask": exactly 13 years back, so ask "Have you had your 13th birthday?" (the answer is used once, never stored).
 * - "under": younger than 13 years back; the account is deleted and nothing is kept.
 * - "invalid": a year that cannot be right (over 120 years back, or in the future is "under").
 */
function ageGate(birthYear: number, now: Date = new Date()): "ok" | "ask" | "under" | "invalid" {
  const age = currentYear(now) - birthYear;
  if (age > 120) return "invalid";
  if (age < 13) return "under";
  return age === 13 ? "ask" : "ok";
}

export type SignUpDecision = "create" | "ask-13" | "under-13" | "bad-year";

/** What to do with a birth year (and the 13th-birthday answer, when asked). The answer is used here and never kept. */
export function decideSignUp(birthYear: number, turned13: "" | "yes" | "no", now: Date = new Date()): SignUpDecision {
  if (birthYear < 1900 || birthYear > currentYear(now)) return "bad-year";
  const gate = ageGate(birthYear, now);
  if (gate === "invalid") return "bad-year";
  if (gate === "under") return "under-13";
  if (gate === "ok") return "create";
  return turned13 === "yes" ? "create" : turned13 === "no" ? "under-13" : "ask-13";
}
