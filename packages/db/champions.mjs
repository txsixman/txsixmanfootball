// Loads state finals from a CSV written by tools/history/uil-champions.mjs. Safe to re-run: a final is matched on
// league, season, class and division and updated in place. Each run leaves an audit row.

import { slugify } from "./seed.mjs";

export const COLUMNS = "season,conference,division,champion,runner_up,champion_score,runner_up_score,score_note,notes,source_url";

export function parseFinals(text) {
  const names = COLUMNS.split(",");
  const [header, ...lines] = text.trim().split("\n");
  if (header !== COLUMNS) throw new Error(`unexpected header: ${header}`);
  return lines.map((line, i) => {
    const cols = line.split(",");
    if (cols.length !== names.length) throw new Error(`bad row ${i + 2}: ${line}`);
    const row = Object.fromEntries(names.map((n, j) => [n, cols[j].trim()]));
    if (!row.season || !row.champion || !row.runner_up || !row.source_url) throw new Error(`row ${i + 2} is incomplete`);
    return row;
  });
}

export async function seedFinals(db, rows, { league, retrievedOn, reason }) {
  return db.transaction(async (tx) => {
    const one = async (sql, params) => (await tx.query(sql, params)).rows[0];
    const program = async (name) => (await one("select id from program where slug = $1", [slugify(name)]))?.id ?? null;
    const result = { inserted: 0, updated: 0, linked: 0, unlinked: [] };
    for (const r of rows) {
      const source = await one(
        `insert into source_document (url, retrieved_on) values ($1, $2)
         on conflict (url) do update set retrieved_on = excluded.retrieved_on returning id`,
        [r.source_url, retrievedOn],
      );
      const [champ, runner] = [await program(r.champion), await program(r.runner_up)];
      for (const [name, id] of [[r.champion, champ], [r.runner_up, runner]]) {
        if (id) result.linked += 1;
        else if (!result.unlinked.includes(name)) result.unlinked.push(name);
      }
      const score = (v) => (v === "" ? null : Number(v));
      const row = await one(
        `insert into state_final (league, season, conference, division, champion_name, runner_up_name,
           champion_program_id, runner_up_program_id, champion_score, runner_up_score, score_note, notes, source_document_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         on conflict (league, season, conference, division) do update set
           champion_name = excluded.champion_name, runner_up_name = excluded.runner_up_name,
           champion_program_id = excluded.champion_program_id, runner_up_program_id = excluded.runner_up_program_id,
           champion_score = excluded.champion_score, runner_up_score = excluded.runner_up_score,
           score_note = excluded.score_note, notes = excluded.notes, source_document_id = excluded.source_document_id
         returning (xmax = 0) as inserted`,
        [league, Number(r.season), r.conference, r.division, r.champion, r.runner_up, champ, runner,
          score(r.champion_score), score(r.runner_up_score), r.score_note || null, r.notes || null, source.id],
      );
      result[row.inserted ? "inserted" : "updated"] += 1;
    }
    result.unlinked.sort();
    await tx.query("insert into audit_log (entity, reason, after) values ('final_import', $1, $2)", [
      reason,
      JSON.stringify({ ...result, unlinked: result.unlinked.length }),
    ]);
    return result;
  });
}
