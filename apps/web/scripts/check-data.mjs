// Checks every seed and robot-read file the site reads against lib/data-schemas.ts (Zod), the same checks the site's
// loaders run at build time. The robot workflows run it after they write and before they commit, so a bad row fails
// the run and never reaches main; CI runs it on every push. Prints one line a file; exits 1 if any file is bad. Then the
// cross-file checks (data-integrity.mjs): hard ones fail the run too, soft ones print and go to the step summary.
//   node apps/web/scripts/check-data.mjs [repo root]
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyToGame, buildCorrections } from "../lib/corrections.ts";
import * as s from "../lib/data-schemas.ts";
import { CURRENT_SEASON, FIRST_SEASON } from "../lib/season.ts";
import { slugify } from "../lib/slug.ts";
import { applyExceptions, checkSeason, gameKey } from "./data-integrity.mjs";

const root = path.resolve(process.argv[2] ?? path.join(import.meta.dirname, "../../.."));
const seed = (...p) => path.join("data/seed", ...p);

/** What the admin console writes (lib/admin); both files appear with the first correction. */
const CORRECTIONS = { programs: "data/corrections/programs.csv", games: "data/corrections/games.csv" };

/** Every file the site reads, with how to check it. */
function files() {
  const list = [];
  const dirs = readdirSync(path.join(root, "data/seed"));
  for (const d of dirs.filter((d) => existsSync(path.join(root, seed(d, "alignments.csv"))))) {
    list.push({ file: seed(d, "alignments.csv"), csv: [s.ALIGNMENT_COLUMNS, s.AlignmentRow] });
  }
  for (const d of dirs) {
    for (const f of readdirSync(path.join(root, "data/seed", d)).filter((f) => /^playoffs-\d{4}\.csv$/.test(f))) {
      list.push({ file: seed(d, f), csv: [s.GAME_COLUMNS, s.PlayoffRow] });
    }
  }
  if (existsSync(path.join(root, seed("disputed")))) {
    for (const f of readdirSync(path.join(root, seed("disputed"))).filter((f) => /^\d{4}\.csv$/.test(f))) {
      list.push({ file: seed(`disputed/${f}`), csv: [s.DISPUTED_COLUMNS, s.DisputedRow] });
    }
  }
  if (existsSync(path.join(root, seed("game-details")))) {
    for (const f of readdirSync(path.join(root, seed("game-details"))).filter((f) => /^\d{4}\.csv$/.test(f))) {
      list.push({ file: seed(`game-details/${f}`), csv: [s.DETAIL_COLUMNS, s.DetailRow] });
    }
  }
  for (const d of dirs.filter((d) => /^maxpreps-\d{4}$/.test(d))) {
    if (existsSync(path.join(root, seed(d, "games.csv")))) list.push({ file: seed(d, "games.csv"), csv: [s.RESULT_COLUMNS, s.PlayedGameRow] });
    if (existsSync(path.join(root, seed(d, "playoffs.csv")))) {
      list.push({ file: seed(d, "playoffs.csv"), csv: [["league", ...s.RESULT_COLUMNS], s.RobotPlayoffRow] });
    }
  }
  list.push(
    { file: CORRECTIONS.programs, csv: [s.PROGRAM_MERGE_COLUMNS, s.ProgramMergeRow], optional: true },
    { file: CORRECTIONS.games, csv: [s.GAME_CORRECTION_COLUMNS, s.GameCorrectionRow], optional: true },
    { file: seed("lineage/programs.csv"), csv: [s.LINEAGE_COLUMNS, s.LineageRow], optional: true },
    { file: seed("uil-champions/six-man.csv"), csv: [s.FINAL_COLUMNS, s.FinalRow], optional: true },
    { file: seed("uil-champions/six-man-no-final.csv"), csv: [s.NO_FINAL_COLUMNS, s.NoFinalRow], optional: true },
    { file: seed("schools/identity.json"), json: s.IdentityFile, optional: true },
    { file: seed("schools/colors.json"), json: s.ColorsFile },
    { file: "tools/history/uil-aliases.json", json: s.AliasesFile },
    { file: "data/ratings/backtest.json", json: s.BacktestFile },
  );
  for (const f of readdirSync(path.join(root, "data/ratings")).filter((f) => /^\d{4}\.json$/.test(f))) {
    list.push({ file: path.join("data/ratings", f), json: s.RatingsTable });
  }
  return list;
}

export function checkAll() {
  const results = [];
  const parsed = {};
  for (const { file, csv, json, optional } of files()) {
    const full = path.join(root, file);
    if (!existsSync(full)) {
      results.push({ file, ok: optional, note: optional ? "absent (optional)" : "missing" });
      continue;
    }
    try {
      const text = readFileSync(full, "utf8");
      if (csv) {
        const rows = s.parseCsv(file, text, ...csv);
        parsed[file] = rows.map(({ row }) => row);
        results.push({ file, ok: true, note: `${rows.length} rows` });
      } else {
        parsed[file] = s.parseJson(file, text, json);
        results.push({ file, ok: true, note: "valid" });
      }
    } catch (e) {
      results.push({ file, ok: false, note: e.message });
    }
  }
  // Corrections as the site applies them: a merge may not point at a name another merge retires.
  if (parsed[CORRECTIONS.programs]) {
    try {
      buildCorrections(parsed[CORRECTIONS.programs], parsed[CORRECTIONS.games] ?? []);
    } catch (e) {
      results.push({ file: CORRECTIONS.programs, ok: false, note: e.message });
    }
  }
  // Every color a school names must be in colors.json (lib/identity.ts throws on one that is not).
  const identity = parsed[seed("schools/identity.json")];
  const colors = parsed[seed("schools/colors.json")];
  if (identity && colors) {
    const unknown = Object.entries(identity.schools).flatMap(([slug, school]) => school.colors.filter((c) => !colors[c]).map((c) => `${slug}: "${c}"`));
    if (unknown.length) results.push({ file: seed("schools/identity.json"), ok: false, note: `colors not in colors.json: ${unknown.join(", ")}` });
  }
  if (identity) results.push(checkLogoFiles(identity));
  results.push(checkFirstSeason());
  results.push(...checkMaxprepsFolders(path.join(root, "data/seed")));
  return results;
}

/** The only files a robot-read folder in this repo may hold: the facts publish.mjs writes (ADRs 0017, 0029). The reader's
 * captures (source pages, teams.csv, outside.csv, coverage.txt) belong in the private data repo only. `.DS_Store` is
 * Finder's, never committed (.gitignore). */
export const MAXPREPS_PUBLIC_FILES = ["games.csv", "playoffs.csv"];

/** One result for each robot-read folder under `seedDir` that holds anything else, or whose name is not maxpreps-<year>. */
export function checkMaxprepsFolders(seedDir) {
  const results = [];
  for (const d of readdirSync(seedDir).filter((d) => d.startsWith("maxpreps")).sort()) {
    const file = seed(d);
    if (!/^maxpreps-\d{4}$/.test(d)) {
      results.push({ file, ok: false, note: "a robot-read folder must be named maxpreps-<year> (ADR 0029)" });
      continue;
    }
    const stray = readdirSync(path.join(seedDir, d)).filter((f) => f !== ".DS_Store" && !MAXPREPS_PUBLIC_FILES.includes(f)).sort();
    if (stray.length) {
      results.push({ file, ok: false, note: `only ${MAXPREPS_PUBLIC_FILES.join(" and ")} may be here; the reader's captures belong in the private data repo (ADR 0029): ${stray.join(", ")}` });
    }
  }
  return results;
}

/** lib/season.ts FIRST_SEASON ("since <year>" on pages, the admin console's seasons) is the oldest season on file. */
function checkFirstSeason() {
  const years = (dir, re) => readdirSync(path.join(root, dir)).flatMap((f) => re.exec(f)?.[1] ?? []).map(Number);
  const oldest = { "data/seed/maxpreps-<year>": Math.min(...years("data/seed", /^maxpreps-(\d{4})$/)), "data/ratings/<year>.json": Math.min(...years("data/ratings", /^(\d{4})\.json$/)) };
  const off = Object.entries(oldest).filter(([, y]) => y !== FIRST_SEASON);
  return {
    file: "apps/web/lib/season.ts",
    ok: off.length === 0,
    note: off.length ? `FIRST_SEASON is ${FIRST_SEASON}, but the oldest ${off.map(([d, y]) => `${d} is ${y}`).join(" and ")}` : `FIRST_SEASON ${FIRST_SEASON} is the oldest season on file`,
  };
}

/** Hand-captured playoff games (lib/games.ts CAPTURES): a robot row for a game captured by hand is left out there too. */
const CAPTURES = [{ file: seed("uil-2026-28/playoffs-2026.csv"), league: "UIL", season: CURRENT_SEASON }];
const EXCEPTIONS = "data/integrity-exceptions.json";

/**
 * The cross-file checks (data-integrity.mjs) on every season, with the corrections applied as the site applies them.
 * Run after checkAll passed, on the same files. `failures`: hard problems (current season) not excused by
 * data/integrity-exceptions.json; `warnings`: everything soft, and history; `excused`: the known ones, still shown.
 */
export function checkIntegrity(today = new Date().toISOString().slice(0, 10)) {
  const read = (file, columns, schema) => (existsSync(path.join(root, file)) ? s.parseCsv(file, readFileSync(path.join(root, file), "utf8"), columns, schema).map(({ row }) => row) : []);
  const fixes = buildCorrections(read(CORRECTIONS.programs, s.PROGRAM_MERGE_COLUMNS, s.ProgramMergeRow), read(CORRECTIONS.games, s.GAME_CORRECTION_COLUMNS, s.GameCorrectionRow));
  const fixed = (rows) => rows.flatMap((r) => applyToGame(fixes, r)?.row ?? []);
  const alignments = readdirSync(path.join(root, "data/seed"))
    .filter((d) => existsSync(path.join(root, seed(d, "alignments.csv"))))
    .flatMap((d) => read(seed(d, "alignments.csv"), s.ALIGNMENT_COLUMNS, s.AlignmentRow));
  const programs = new Set(alignments.map((a) => slugify(a.school)));

  const hard = [];
  const warnings = [];
  const seasons = readdirSync(path.join(root, "data/seed")).flatMap((d) => /^maxpreps-(\d{4})$/.exec(d)?.[1] ?? []).map(Number).sort();
  for (const season of seasons) {
    const games = fixed(read(seed(`maxpreps-${season}`, "games.csv"), s.RESULT_COLUMNS, s.PlayedGameRow));
    const captured = CAPTURES.filter((c) => c.season === season).flatMap((c) => fixed(read(c.file, s.GAME_COLUMNS, s.PlayoffRow)).map((r) => ({ ...r, league: c.league })));
    const seen = new Set(captured.map(gameKey));
    const robot = fixed(read(seed(`maxpreps-${season}`, "playoffs.csv"), ["league", ...s.RESULT_COLUMNS], s.RobotPlayoffRow)).filter((r) => !seen.has(gameKey(r)));
    const current = season === CURRENT_SEASON;
    const out = checkSeason({ season, current, games, playoffs: [...captured, ...robot], programs: current ? programs : undefined, today });
    hard.push(...out.hard);
    warnings.push(...out.soft);
  }
  const exceptions = existsSync(path.join(root, EXCEPTIONS)) ? JSON.parse(readFileSync(path.join(root, EXCEPTIONS), "utf8")) : [];
  // No source column: this repo names no source (ADR 0010); the private data repo keeps the game's pages.
  const bad = exceptions.filter((e) => !(typeof e?.key === "string" && typeof e.reason === "string" && e.reason.length > 20 && /^\d{4}-\d{2}-\d{2}$/.test(e.reviewed ?? "")));
  const { failures, excused } = applyExceptions(hard, exceptions.filter((e) => !bad.includes(e)));
  for (const e of bad) failures.push(`${EXCEPTIONS}: an exception needs a key, a reason and a reviewed date: ${JSON.stringify(e).slice(0, 120)}`);
  return { failures, warnings, excused };
}

/**
 * Every stored logo has its untouched original on disk, byte for byte what was downloaded (its sha256), and every
 * edited logo (`edit` note) has the stored file it describes (ADR 0016).
 */
function checkLogoFiles(identity) {
  const file = seed("schools/identity.json");
  const problems = [];
  for (const [slug, { logo }] of Object.entries(identity.schools)) {
    if (!logo?.file) {
      if (logo?.original || logo?.edit) problems.push(`${slug}: has an original or edit note but no stored file`);
      continue;
    }
    if (!existsSync(path.join(root, "apps/web/public/logos", logo.file))) problems.push(`${slug}: stored file ${logo.file} is missing`);
    const original = path.join(root, "data/seed/schools/logo-originals", logo.original ?? "-");
    if (!existsSync(original)) problems.push(`${slug}: original ${logo.original} is missing from logo-originals/`);
    else if (createHash("sha256").update(readFileSync(original)).digest("hex") !== logo.sha256) problems.push(`${slug}: original ${logo.original} is not the download its sha256 names`);
  }
  return problems.length ? { file, ok: false, note: `logo files: ${problems.slice(0, 20).join("; ")}` } : { file, ok: true, note: "logo files and originals match" };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const results = checkAll();
  for (const r of results) console.log(`${r.ok ? "ok  " : "BAD "} ${r.file}: ${r.note}`);
  const bad = results.filter((r) => !r.ok).length;
  console.log(bad ? `${bad} file(s) failed the data checks.` : `All ${results.length} data files pass.`);
  if (bad) process.exit(1);
  // The cross-file checks need every file to parse, so they run only after the checks above pass.
  process.exit(reportIntegrity(checkIntegrity(), process.env));
}

/**
 * Prints the cross-file results, adds them to the run summary, and gives the exit code. INTEGRITY=report (Results watch,
 * during the playoffs): a hard failure still prints and goes to the summary, and to the file INTEGRITY_REPORT names,
 * but exits 0, so one bad source row never holds back every final on a Friday night; the workflow fails the job from
 * that file after its push, so the owner is still emailed. Anything else: a hard failure exits 1 (CI, check.sh).
 * The Zod checks above never take this path: a malformed row always blocks.
 */
export function reportIntegrity({ failures, warnings, excused }, env = {}, log = console.log) {
  const report = env.INTEGRITY === "report";
  for (const f of failures) log(`BAD  integrity: ${f}`);
  for (const e of excused) log(`known integrity: ${e}`);
  for (const w of warnings) log(`warn integrity: ${w}`);
  log(
    failures.length
      ? `${failures.length} cross-file check(s) failed${report ? " (report mode: not blocking; the job fails after its push)" : "."}`
      : `Cross-file checks pass (${excused.length} known, ${warnings.length} warning(s)).`,
  );
  if (env.GITHUB_STEP_SUMMARY && (failures.length || warnings.length || excused.length)) {
    const list = (title, items) => (items.length ? `\n**${title}**\n\n${items.map((i) => `- ${i}`).join("\n")}\n` : "");
    const failed = report ? "Failed (reported; pushed anyway, the job fails at the end)" : "Failed";
    appendFileSync(env.GITHUB_STEP_SUMMARY, `### Data checks\n${list(failed, failures)}${list("Known (data/integrity-exceptions.json)", excused)}${list("Warnings", warnings)}\n`);
  }
  if (report && failures.length) {
    if (!env.INTEGRITY_REPORT) {
      log("INTEGRITY=report needs INTEGRITY_REPORT (a file the workflow fails on after its push); blocking instead.");
      return 1;
    }
    appendFileSync(env.INTEGRITY_REPORT, failures.map((f) => `${f}\n`).join(""));
    return 0;
  }
  return failures.length ? 1 : 0;
}
