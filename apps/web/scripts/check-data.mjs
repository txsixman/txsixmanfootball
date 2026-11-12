// Checks every seed and robot-read file the site reads against lib/data-schemas.ts (Zod), the same checks the site's
// loaders run at build time. The robot workflows run it after they write and before they commit, so a bad row fails
// the run and never reaches main; CI runs it on every push. Prints one line a file; exits 1 if any file is bad.
//   node apps/web/scripts/check-data.mjs [repo root]
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as s from "../lib/data-schemas.ts";

const root = path.resolve(process.argv[2] ?? path.join(import.meta.dirname, "../../.."));
const seed = (...p) => path.join("data/seed", ...p);

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
  for (const d of dirs.filter((d) => /^maxpreps-\d{4}$/.test(d))) {
    if (existsSync(path.join(root, seed(d, "games.csv")))) list.push({ file: seed(d, "games.csv"), csv: [s.RESULT_COLUMNS, s.PlayedGameRow] });
    if (existsSync(path.join(root, seed(d, "playoffs.csv")))) {
      list.push({ file: seed(d, "playoffs.csv"), csv: [["league", ...s.RESULT_COLUMNS], s.RobotPlayoffRow] });
    }
  }
  list.push(
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
        results.push({ file, ok: true, note: `${rows.length} rows` });
      } else {
        parsed[file] = s.parseJson(file, text, json);
        results.push({ file, ok: true, note: "valid" });
      }
    } catch (e) {
      results.push({ file, ok: false, note: e.message });
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
  return results;
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
  process.exit(bad ? 1 : 0);
}
