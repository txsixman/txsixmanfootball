import { z } from "zod";

// What the console's forms may send. Every server action runs its FormData through one of these before it does anything
// else (and the finished correction row is checked again against the file schemas, lib/data-schemas.ts). Only zod.

/**
 * One line for a CSV cell: line breaks and runs of spaces become one space, commas become semicolons and double quotes
 * apostrophes (the files hold neither: a quote would open a quoted cell and swallow the rows below it).
 */
export const oneLine = (s: string) => s.replace(/\s+/g, " ").replace(/,/g, ";").replace(/"/g, "'").trim();

/** Free text for a CSV cell: one line, and no leading = + - or @ (a spreadsheet would run the cell as a formula). */
export const freeText = (s: string) => oneLine(s).replace(/^[=+\-@\s]+/, "");

/** A URL for a CSV cell: commas in it are written %2C and quotes %22, which every server reads as the same address. */
export const urlCell = (s: string) => s.trim().replace(/,/g, "%2C").replace(/"/g, "%22");

const reason = z.string().max(300).transform(freeText).pipe(z.string().min(3, "Say why, in a few words").max(200, "Keep the reason under 200 characters"));
const sourceUrl = z
  .string()
  .max(600)
  .transform(urlCell)
  .pipe(z.url({ protocol: /^https$/, hostname: z.regexes.domain, error: "A public https:// page that shows the right fact" }));
const score = z
  .string()
  .regex(/^\d{1,3}$/, "A whole number")
  .transform(Number)
  .pipe(z.number().int().min(0, "0 to 200").max(200, "0 to 200"));
const name = z.string().max(200).transform(freeText).pipe(z.string().min(2).max(120));

const gameId = z.string().max(200).regex(/^20\d\d-\d{2}-\d{2}-[a-z0-9-]+-at-[a-z0-9-]+$/, "Not a game id");

export const GameFixInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("score"), id: gameId, home_score: score, away_score: score, source_url: sourceUrl, reason }),
  z.object({ action: z.literal("forfeit"), id: gameId, winner: z.enum(["home", "away"]), source_url: sourceUrl, reason }),
  z.object({ action: z.literal("void"), id: gameId, source_url: sourceUrl, reason }),
]);
export type GameFixInput = z.output<typeof GameFixInput>;

export const MergeInput = z.object({ name, same_as: name, source_url: sourceUrl, reason }).refine((v) => v.name !== v.same_as, {
  message: "A name cannot be merged into itself",
  path: ["same_as"],
});
export type MergeInput = z.output<typeof MergeInput>;

/** A moderation override (migration 0013's admin_* functions): what to do, to which post or account, and why. */
export const ModerateInput = z.object({ op: z.enum(["unhide", "unmute", "ban", "unban"]), id: z.uuid(), reason });
export type ModerateInput = z.output<typeof ModerateInput>;

/** The search box: a team's name and/or a date. At least one, so the console never lists a season at once. */
export const SearchInput = z
  .object({
    q: z.string().max(80).transform(oneLine).optional(),
    date: z.string().regex(/^20\d\d-\d{2}-\d{2}$/, "Use YYYY-MM-DD").optional().or(z.literal("").transform(() => undefined)),
  })
  .refine((v) => v.q || v.date, { message: "Type a team or a date" });

/** Zod's issues as `{ field: first message }` for a form to show beside each field. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) out[String(issue.path[0] ?? "form")] ??= issue.message;
  return out;
}

/** Only the named fields of a FormData, as strings (a file or a missing field becomes ""), so nothing else reaches a schema. */
export function formFields(data: FormData, names: string[]): Record<string, string> {
  return Object.fromEntries(names.map((n) => [n, typeof data.get(n) === "string" ? (data.get(n) as string) : ""]));
}
