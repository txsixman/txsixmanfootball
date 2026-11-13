import { z } from "zod";

// Every seed and robot-read file the site reads, checked row by row with Zod (MIT) where it is loaded. A bad row
// throws with its file and line, so the build (CI, Vercel) or the robot run that wrote it fails before any page shows
// it. Imports nothing but zod: scripts/check-data.mjs runs this file under plain Node in the robot workflows.

const ROUNDS = ["season", "round-1", "bi-district", "area", "quarterfinal", "regional", "semifinal", "final", "state"] as const;
const END_REASONS = ["regulation", "overtime", "mercy_half", "mercy_2h", "forfeit", "unknown"] as const; // migration 0001

const text = z.string().trim().min(1);
const url = z.url({ protocol: /^https?$/ });
const isoDate = z.iso.date().refine((d) => d >= "1938-01-01" && d <= "2100-12-31", "date outside 1938 to 2100");
const score = z.string().regex(/^\d{1,3}$/, "a score is a whole number");
const blank = z.literal("");

/** One game row: a regular-season game (games.csv) or a playoff game (playoffs.csv, the hand capture files). */
const gameFields = {
  division: z.string().regex(/^(I|II|III|IV|[1-9]|Six-Man)( (Large|Small) School)?$/, "unknown division"),
  round: z.enum(ROUNDS),
  game_date: isoDate,
  home: text,
  away: text,
  neutral: z.enum(["", "true", "false"]),
  home_score: score.or(blank),
  away_score: score.or(blank),
  end_reason: z.enum(END_REASONS).or(blank),
  end_period: z.string().regex(/^\d?$/, "end_period is one digit or blank"),
  source_url: url,
  notes: z.string(),
};
const gameChecks = <T extends z.ZodType<{ home: string; away: string; home_score: string; away_score: string; end_reason: string }>>(s: T) =>
  s
    .refine((r) => r.home !== r.away, "a team cannot play itself")
    .refine((r) => (r.home_score === "") === (r.away_score === ""), "both scores or neither")
    .refine((r) => r.home_score === "" || r.end_reason !== "", "a played game needs an end_reason");

export const GAME_COLUMNS = Object.keys(gameFields);
export const PlayoffRow = gameChecks(z.object(gameFields));
/** Robot-read results as this repo holds them (data/seed/maxpreps-*): the facts only. The reader's own files, with each
 * game's source page, are kept in a private data repo (results-watch.yml); tools/league-watch/publish.mjs copies these
 * columns from them. */
const { source_url: _sourceUrl, notes: _notes, ...resultFields } = gameFields;
export const RESULT_COLUMNS = Object.keys(resultFields);
export const RobotPlayoffRow = gameChecks(z.object({ league: z.enum(["UIL", "TAPPS", "TAIAO", "TCAF"]), ...resultFields }));
/** games.csv holds played games only: both scores are required. */
export const PlayedGameRow = gameChecks(z.object(resultFields)).refine((r) => r.home_score !== "", "games.csv holds played games only");

/** data/seed/game-details/<year>.csv (ADR 0036): a game's kickoff in UTC and its site, the teams as the bracket spells
 * them; no source. A blank field is not known. */
export const DETAIL_COLUMNS = ["date", "home", "away", "kickoff_utc", "site_name", "site_city"];
export const DetailRow = z.object({
  date: isoDate,
  home: z.string().min(1).max(80),
  away: z.string().min(1).max(80),
  kickoff_utc: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/, "a UTC time, 2026-11-14T01:00:00Z")]),
  site_name: z.string().max(80),
  site_city: z.string().max(60),
});

export const ALIGNMENT_COLUMNS = ["league", "division", "region", "district", "school", "source_url"];
export const AlignmentRow = z.object({
  league: z.enum(["UIL", "TAPPS", "TAIAO", "TCAF", "TCAL", "TCSAAL", "Independent"]),
  division: text,
  region: z.string(),
  district: text,
  school: text,
  source_url: url,
});

export const LINEAGE_COLUMNS = ["predecessor", "successor", "event", "season", "source_url", "notes"];
export const LineageRow = z.object({
  predecessor: text,
  successor: text,
  event: text,
  season: z.string().regex(/^(19|20)\d\d$/, "season is a year"),
  source_url: url,
  notes: z.string(),
});

// ---- Corrections (data/corrections/, written by the admin console, lib/admin) -----------------------------------------
// Each row is one person's fix to a robot-read fact, with a public page that shows the right fact (ADR 0002) and a
// reason. Files are append-only logs: for the same game (or name) the LAST row wins, and the rows above it stay as
// history. A correction never names a winner and never marks a score confirmed (ADR 0011): the rows below carry scores,
// and pages keep calling a corrected score unconfirmed. The files hold no quoted cells (parseCsv), so no field may
// contain a comma, a double quote or a line break; the console turns commas into semicolons and quotes into apostrophes.

// No comma, no double quote (a quote would open a quoted cell in a spreadsheet or csv reader and swallow the rows below it),
// no line break, and no leading = + - or @ (a spreadsheet would run the cell as a formula).
const csvSafe = (what: string) =>
  z
    .string()
    .trim()
    .min(1)
    .max(300)
    .regex(/^[^,"\r\n]+$/, `${what} may not hold a comma, a double quote or a line break`)
    .regex(/^[^=+\-@]/, `${what} may not start with = + - or @`);
const httpsUrl = csvSafe("a url").pipe(z.url({ protocol: /^https$/, hostname: z.regexes.domain })).refine((u) => u.length <= 500, "url too long");
const fixScore = z.string().regex(/^\d{1,3}$/, "a score is a whole number").refine((v) => Number(v) <= 200, "a score is 0 to 200");
// Same rule as `forfeitScore` in lib/forfeit.ts and `forfeit_score` in services/ratings/rows.py (this file imports
// nothing but zod, so it cannot import the lib one; scripts/corrections.test.mjs holds the three to one table).
const forfeitShaped = (a: number, b: number) => Math.max(a, b) <= 2 && Math.min(a, b) === 0 && a !== b;

export const GAME_CORRECTION_COLUMNS = [
  "game_date", "home", "away", "action", "home_score", "away_score", "source_url", "reason", "corrected_on",
];
/**
 * One fix to one game, found by its date and the two teams (either way round, names as the game files spell them after
 * program merges). `score`: the right score. `forfeit`: the game was forfeited; the score is the way results record one,
 * 1-0 or 2-0 to the side that won it, which both the pages and the ratings already read as a forfeit. `void`: the game was
 * listed in error and is left out everywhere.
 */
export const GameCorrectionRow = z
  .object({
    game_date: isoDate,
    home: csvSafe("a team"),
    away: csvSafe("a team"),
    action: z.enum(["score", "forfeit", "void"]),
    home_score: fixScore.or(blank),
    away_score: fixScore.or(blank),
    source_url: httpsUrl,
    reason: csvSafe("a reason"),
    corrected_on: isoDate,
  })
  .superRefine((r, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: "custom", message });
    if (r.home === r.away) issue("a team cannot play itself");
    if (r.action === "void") {
      if (r.home_score !== "" || r.away_score !== "") issue("a void carries no score");
      return;
    }
    if (r.home_score === "" || r.away_score === "") return issue("a score or forfeit needs both scores");
    const [h, a] = [Number(r.home_score), Number(r.away_score)];
    if (r.action === "forfeit" && !forfeitShaped(h, a)) issue("a forfeit is recorded 1-0 or 2-0 to the winner");
    if (r.action === "score" && (forfeitShaped(h, a) || (h === 0 && a === 0))) {
      issue("1-0, 2-0 and 0-0 are a forfeit or a game nobody played: use forfeit or void");
    }
  });

export const PROGRAM_MERGE_COLUMNS = ["name", "same_as", "source_url", "reason", "corrected_on"];
/** `name` is a spelling the game files use that no alignment lists; `same_as` is the listed program it is. */
export const ProgramMergeRow = z
  .object({ name: csvSafe("a name"), same_as: csvSafe("a name"), source_url: httpsUrl, reason: csvSafe("a reason"), corrected_on: isoDate })
  .refine((r) => r.name !== r.same_as, "a name cannot be merged into itself");

export const FINAL_COLUMNS = [
  "season", "conference", "division", "champion", "runner_up", "champion_score", "runner_up_score", "score_note", "notes", "source_url",
];
export const FinalRow = z
  .object({
    season: z.string().regex(/^(19|20)\d\d$/, "season is a year"),
    conference: z.string(),
    division: z.enum(["", "I", "II"]),
    champion: text,
    runner_up: text,
    champion_score: score.or(blank),
    runner_up_score: score.or(blank),
    score_note: z.string(),
    notes: z.string(),
    source_url: url,
  })
  .refine((r) => (r.champion_score === "") === (r.runner_up_score === ""), "both scores or neither");

export const NO_FINAL_COLUMNS = ["season", "conference", "played_to", "source_url"];
export const NoFinalRow = z.object({
  season: z.string().regex(/^(19|20)\d\d$/, "season is a year"),
  conference: z.string(),
  played_to: text,
  source_url: url,
});

export const RatingsTable = z.object({
  season: z.number().int().optional(),
  games: z.number().int().nonnegative(),
  games_outside: z.number().int().nonnegative().optional(),
  home_field: z.number().optional(),
  sigma: z.number().positive().optional(),
  playoff_edge: z.number().min(0).max(1).optional(),
  calibration: z.object({ family: z.literal("logistic"), scale: z.number().positive() }).optional(),
  group_means: z.record(z.string(), z.number()).optional(),
  report: z.record(z.string(), z.number()).optional(),
  weeks: z.array(z.iso.date()).optional(),
  week_home_field: z.array(z.number().nullable()).optional(),
  week_sigma: z.array(z.number().nullable()).optional(),
  teams: z.array(
    z.object({
      team: text,
      rating: z.number(),
      sd: z.number().nonnegative().optional(),
      rated: z.number().int().nonnegative(),
      rated_outside: z.number().int().nonnegative().optional(),
      won: z.number().int().nonnegative(),
      lost: z.number().int().nonnegative(),
      tied: z.number().int().nonnegative(),
      was: z.number().nullable().optional(),
      trend: z.array(z.number().nullable()).optional(),
      rated_trend: z.array(z.number().int().nonnegative().nullable()).optional(),
    }).loose(),
  ),
}).loose();

/** tools/history/uil-aliases.json: UIL's spelling of a school → its current name, beside a `_note`. */
export const AliasesFile = z.object({ _note: z.string().optional() }).catchall(z.string());

/** data/ratings/backtest.json (services/ratings/backtest.py): the walk-forward backtest the /rankings/how page shows. */
const BacktestScores = z.object({
  accuracy: z.number().min(0).max(1),
  mae: z.number().nonnegative(),
  log_loss: z.number().nonnegative(),
  brier: z.number().nonnegative(),
});
const BacktestMethods = z.object({
  model: BacktestScores,
  elo: BacktestScores,
  last_season: BacktestScores.nullable().optional(), // 2021 has no earlier season
  model_no_prior: BacktestScores,
});
/** One split of the scorecard: games, the favorite's average chance said, how often the favorite won, and the same by band. */
const ScorecardBand = z.object({ from: z.number(), to: z.number(), games: z.number().int().positive(), said: z.number().min(0).max(1), happened: z.number().min(0).max(1) });
const ScorecardRow = z.object({ label: z.string(), games: z.number().int().positive(), said: z.number().min(0).max(1), happened: z.number().min(0).max(1), bands: z.array(ScorecardBand).min(1) });
export const BacktestFile = z.object({
  scorecard: z.object({ bands: z.array(z.number()), season: z.array(ScorecardRow).min(1), phase: z.array(ScorecardRow).min(1), league: z.array(ScorecardRow).min(1) }),
  seasons: z.array(BacktestMethods.extend({ season: z.number().int(), games: z.number().int().positive() }).loose()).min(1),
  overall_from_2022: BacktestMethods.extend({ games: z.number().int().positive() }).loose(),
}).loose();

const sourced = z.url({ protocol: /^https?$/ }).nullable();
export const IdentityFile = z.object({
  removed: z.array(z.string()).default([]),
  schools: z.record(
    z.string().regex(/^[a-z0-9-]+$/, "a slug is lowercase letters, digits and hyphens"),
    z.object({
      school: text,
      site: sourced,
      mascot: z.string().nullable(),
      mascotSource: sourced,
      colors: z.array(text),
      colorsSource: sourced,
      logo: z
        .object({
          image: url,
          page: url,
          file: z.string().regex(/^[a-z0-9-]+\.(png|jpe?g|gif|webp|svg)$/, "a logo file is <slug>.<image type>").optional(),
          aspect: z.number().positive().optional(),
          light: z.boolean().optional(),
          /** By hand: which tile the site draws this logo on, overriding `light` (the measured guess) for a mixed logo,
           * e.g. white lettering beside a colored emblem. "dark" is the school's color, "white" is white. */
          tile: z.enum(["dark", "white"]).optional(),
          retrievedOn: z.iso.date().optional(),
          sha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
          /** The untouched download, in data/seed/schools/logo-originals/ (ADR 0016); every stored logo has one. */
          original: z.string().regex(/^[a-z0-9-]+\.(png|jpe?g|gif|webp|svg)$/, "an original is <slug>.<image type>").optional(),
          /** What was done to the stored file beyond shrinking it; present exactly when the file was edited. */
          edit: z.string().min(10).optional(),
          /** A hand-chosen crop of the original, in its pixels (a mark cut out of a banner). */
          crop: z.object({ left: z.number().int().min(0), top: z.number().int().min(0), width: z.number().int().positive(), height: z.number().int().positive() }).optional(),
          /** True when a solid background is part of the design and must not be stripped. */
          keepBackground: z.boolean().optional(),
        })
        .superRefine((logo, ctx) => {
          if (logo.file && !logo.original) ctx.addIssue({ code: "custom", path: ["original"], message: "a stored logo needs its untouched original (ADR 0016)" });
          if (logo.file && !logo.sha256) ctx.addIssue({ code: "custom", path: ["sha256"], message: "a stored logo needs the sha256 of its download" });
          if (logo.crop && !logo.edit) ctx.addIssue({ code: "custom", path: ["edit"], message: "a cropped logo needs an edit note" });
        })
        .nullable(),
      notes: z.string().optional(),
    }),
  ),
});
/** Color name to #rrggbb; a key starting with "_" is a note for people. */
export const ColorsFile = z.record(text, z.string()).superRefine((colors, ctx) => {
  for (const [name, hex] of Object.entries(colors)) {
    if (!name.startsWith("_") && !/^#[0-9a-f]{6}$/i.test(hex)) ctx.addIssue({ code: "custom", path: [name], message: "a color is #rrggbb" });
  }
});

/** Throws one error naming the file, the line and what is wrong, for every bad row at once. */
class DataError extends Error {
  constructor(file: string, problems: string[]) {
    super(`${file}: ${problems.length} bad row(s)\n  ${problems.slice(0, 20).join("\n  ")}`);
    this.name = "DataError";
  }
}

const describe = (error: z.ZodError) => error.issues.map((i) => `${i.path.join(".") || "row"}: ${i.message}`).join("; ");

/**
 * A CSV file's rows, checked: the header must be `columns` exactly, every line must have that many fields (the files
 * hold no quoted commas), and every row must pass `schema`. Values are trimmed. Returns the rows with their line number.
 */
export function parseCsv<S extends z.ZodType>(file: string, csv: string, columns: string[], schema: S): { row: z.output<S>; line: number }[] {
  const [header, ...lines] = csv.trim().split("\n").map((l) => l.replace(/\r$/, ""));
  if (header !== columns.join(",")) throw new DataError(file, [`header is "${header}", expected "${columns.join(",")}"`]);
  const rows: { row: z.output<S>; line: number }[] = [];
  const problems: string[] = [];
  lines.forEach((text, i) => {
    const line = i + 2;
    const fields = text.split(",");
    if (fields.length !== columns.length) {
      problems.push(`line ${line}: ${fields.length} fields, expected ${columns.length}`);
      return;
    }
    const parsed = schema.safeParse(Object.fromEntries(columns.map((c, j) => [c, fields[j].trim()])));
    if (parsed.success) rows.push({ row: parsed.data, line });
    else problems.push(`line ${line}: ${describe(parsed.error)}`);
  });
  if (problems.length) throw new DataError(file, problems);
  return rows;
}

/** A JSON file, checked against `schema`. */
export function parseJson<S extends z.ZodType>(file: string, json: string, schema: S): z.output<S> {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (e) {
    throw new DataError(file, [`not JSON: ${(e as Error).message}`]);
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new DataError(file, parsed.error.issues.slice(0, 20).map((i) => `${i.path.join(".")}: ${i.message}`));
  return parsed.data;
}
