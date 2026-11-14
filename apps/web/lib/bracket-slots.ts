import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { type SlotRow, uilSlotRows } from "./bracket-fill.ts";
import { BRACKET_COLUMNS, BracketSlotRow, parseCsv, UIL_BRACKET_COLUMNS, UilBracketRow } from "./data-schemas.ts";
import { memo } from "./memo.ts";

// A season's bracket slots (ADR 0047): data/seed/brackets/<season>.csv, written by a league reader (tools/league-watch/
// taiao.mjs), never by hand, and UIL's own bracket, data/seed/uil-<span>/bracket-<season>.csv, entered by hand. Read at
// build time; a missing file means no league's own bracket, only what the data closes.

const seedDir = () => path.join(process.cwd(), "../../data/seed");
const readIf = (file: string) =>
  readFile(file, "utf8").catch((e: NodeJS.ErrnoException) => {
    if (e.code === "ENOENT") return "";
    throw e;
  });

export const loadSlotRows = memo(async (season: number): Promise<SlotRow[]> => {
  const SEED = seedDir();
  const file = path.join(SEED, "brackets", `${season}.csv`);
  const text = await readIf(file);
  const robot = text.trim() ? parseCsv(file, text, BRACKET_COLUMNS, BracketSlotRow).map(({ row }) => row) : [];
  const uil = await Promise.all(
    (await readdir(SEED)).filter((d) => /^uil-\d{4}-\d{2}$/.test(d)).map(async (d) => {
      const f = path.join(SEED, d, `bracket-${season}.csv`);
      const t = await readIf(f);
      return t.trim() ? uilSlotRows(parseCsv(f, t, UIL_BRACKET_COLUMNS, UilBracketRow).map(({ row }) => row)) : [];
    }),
  );
  return [...robot, ...uil.flat()];
});
