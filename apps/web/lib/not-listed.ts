import { readFile } from "node:fs/promises";
import path from "node:path";
import { NOT_LISTED_COLUMNS, NotListedRow, parseCsv } from "./data-schemas";
import { memo } from "./memo";

/** One league the registry is still missing programs from (ADR 0073): why, and the teams it knows of, if any. */
type NotListedLeague = { league: string; reasons: string[]; schools: string[] };

const FILE = "data/seed/private-2026/not-listed.csv";

/** What the registry knows it is missing, by league in file order. A league's blank-school rows give its reasons; each
 * school row is one team no public page yet places. The source column stays in the data (ADR 0010). */
export const loadNotListed = memo<void, NotListedLeague[]>(async () => {
  // No file means nothing is known to be missing; any other read error fails the build.
  const text = await readFile(path.join(process.cwd(), `../../${FILE}`), "utf8").catch((e) => {
    if (e?.code === "ENOENT") return "";
    throw e;
  });
  if (!text) return [];
  const leagues = new Map<string, NotListedLeague>();
  for (const { row } of parseCsv(FILE, text, NOT_LISTED_COLUMNS, NotListedRow)) {
    const l = leagues.get(row.league) ?? { league: row.league, reasons: [], schools: [] };
    if (row.school) l.schools.push(row.school);
    else l.reasons.push(row.reason);
    leagues.set(row.league, l);
  }
  return [...leagues.values()];
});
