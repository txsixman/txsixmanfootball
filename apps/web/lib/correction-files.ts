import { readFile } from "node:fs/promises";
import path from "node:path";
import { buildCorrections, type Corrections } from "./corrections";
import { GAME_CORRECTION_COLUMNS, GameCorrectionRow, PROGRAM_MERGE_COLUMNS, parseCsv, ProgramMergeRow } from "./data-schemas";
import { memo } from "./memo";

/** data/corrections/*.csv, read at build time (absent until the first correction). A bad row fails the build. */
const read = (file: string) =>
  readFile(path.join(process.cwd(), "../../data/corrections", file), "utf8").catch((e: NodeJS.ErrnoException) => {
    if (e.code === "ENOENT") return "";
    throw e;
  });

/** Shared across pages: never mutate it. */
export const loadCorrections = memo<void, Corrections>(async () => {
  const [merges, games] = await Promise.all([read("programs.csv"), read("games.csv")]);
  return buildCorrections(
    merges ? parseCsv("data/corrections/programs.csv", merges, PROGRAM_MERGE_COLUMNS, ProgramMergeRow).map(({ row }) => row) : [],
    games ? parseCsv("data/corrections/games.csv", games, GAME_CORRECTION_COLUMNS, GameCorrectionRow).map(({ row }) => row) : [],
  );
});
