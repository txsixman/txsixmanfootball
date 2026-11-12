// Loads program lineage (ADR 0003) from data/seed/lineage/programs.csv, a hand file where every row cites its source.
// A predecessor that is no current program (a school that merged or closed) gets a program row of its own, so its
// state finals link to it and, through the lineage row, to today's program. The successor must already exist.
// Safe to re-run: a row is matched on its two programs and updated in place. Each run leaves an audit row.

import { slugify } from "./seed.mjs";

export const LINEAGE_COLUMNS = "predecessor,successor,event,season,source_url,notes";
const EVENTS = new Set(["rename", "consolidation", "split", "coop"]);

export function parseLineage(text) {
  const names = LINEAGE_COLUMNS.split(",");
  const [header, ...lines] = text.trim().split("\n");
  if (header !== LINEAGE_COLUMNS) throw new Error(`unexpected lineage header: ${header}`);
  return lines.map((line, i) => {
    const cols = line.split(",");
    if (cols.length !== names.length) throw new Error(`lineage row ${i + 2} has ${cols.length} columns (no commas in notes)`);
    const row = Object.fromEntries(names.map((n, j) => [n, cols[j].trim()]));
    if (!row.predecessor || !row.successor) throw new Error(`lineage row ${i + 2} is missing a program`);
    if (!EVENTS.has(row.event)) throw new Error(`lineage row ${i + 2}: unknown event "${row.event}"`);
    if (!/^\d{4}$/.test(row.season)) throw new Error(`lineage row ${i + 2}: season "${row.season}"`);
    if (!/^https:\/\//.test(row.source_url)) throw new Error(`lineage row ${i + 2} cites no source`);
    return { ...row, season: Number(row.season) };
  });
}

export async function seedLineage(db, rows, { retrievedOn, reason }) {
  return db.transaction(async (tx) => {
    const one = async (sql, params) => (await tx.query(sql, params)).rows[0];
    const result = { inserted: 0, updated: 0, programsAdded: 0 };
    for (const r of rows) {
      const successor = await one("select id from program where slug = $1", [slugify(r.successor)]);
      if (!successor) throw new Error(`lineage: ${r.successor} is not a program`);
      let predecessor = await one("select id from program where slug = $1", [slugify(r.predecessor)]);
      if (!predecessor) {
        predecessor = await one("insert into program (slug) values ($1) returning id", [slugify(r.predecessor)]);
        result.programsAdded += 1;
      }
      const source = await one(
        `insert into source_document (url, retrieved_on) values ($1, $2)
         on conflict (url) do update set retrieved_on = excluded.retrieved_on returning id`,
        [r.source_url, retrievedOn],
      );
      const row = await one(
        `insert into program_lineage (predecessor_id, successor_id, event, season, source_document_id, notes)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (predecessor_id, successor_id) do update set event = excluded.event, season = excluded.season,
           source_document_id = excluded.source_document_id, notes = excluded.notes
         returning (xmax = 0) as inserted`,
        [predecessor.id, successor.id, r.event, r.season, source.id, r.notes || null],
      );
      result[row.inserted ? "inserted" : "updated"] += 1;
    }
    await tx.query("insert into audit_log (entity, reason, after) values ('lineage_import', $1, $2)", [
      reason,
      JSON.stringify(result),
    ]);
    return result;
  });
}
