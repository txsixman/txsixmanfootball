// Loads a league alignment CSV. Safe to re-run: existing programs are reused and team-seasons updated in place.

export const slugify = (name) =>
  name.toLowerCase().replace(/'/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function parseAlignments(text) {
  const [header, ...lines] = text.trim().split("\n");
  if (header !== "league,division,region,district,school,source_url") throw new Error(`unexpected header: ${header}`);
  return lines.map((line, i) => {
    const cols = line.split(",");
    if (cols.length !== 6 || cols.some((c, j) => !c && j !== 2)) throw new Error(`bad row ${i + 2}: ${line}`);
    const [league, division, region, district, school, source_url] = cols;
    return { league, division, region, district, school, source_url };
  });
}

/** Records that a league lists the team that season, and drops leagues this file no longer lists it in. */
async function addLeague(tx, teamSeasonId, [league, division, region, district, sourceId], listed) {
  await tx.query(
    `insert into team_season_league (team_season_id, league, division, region, district, source_document_id)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (team_season_id, league) do update set
       division = excluded.division, region = excluded.region, district = excluded.district,
       source_document_id = excluded.source_document_id`,
    [teamSeasonId, league, division, region, district, sourceId],
  );
  await tx.query("delete from team_season_league where team_season_id = $1 and league <> all($2::text[])", [teamSeasonId, listed]);
}

export async function seedAlignments(db, rows, { seasons, retrievedOn, reason }) {
  // A school may be listed once a league (ADR 0012: Grayson Christian is in TCAF and TAIAO); twice in one league is a mistake.
  const keys = rows.map((r) => `${slugify(r.school)}|${r.league}`);
  const repeated = keys.filter((k, i) => keys.indexOf(k) !== i);
  if (repeated.length) throw new Error(`duplicate slugs: ${repeated.join(", ")}`);
  /** The leagues this file lists a slug in, in file order: the first is the team-season's own league. */
  const leaguesOf = Map.groupBy(rows, (r) => slugify(r.school));

  return db.transaction(async (tx) => {
    const one = async (sql, params) => (await tx.query(sql, params)).rows[0];
    let programsAdded = 0;

    for (const r of rows) {
      const source = await one(
        `insert into source_document (url, retrieved_on) values ($1, $2)
         on conflict (url) do update set retrieved_on = excluded.retrieved_on returning id`,
        [r.source_url, retrievedOn],
      );

      const slug = slugify(r.school);
      let program = await one("select id from program where slug = $1", [slug]);
      if (!program) {
        program = await one("insert into program (slug) values ($1) returning id", [slug]);
        const school = await one("insert into school (canonical_name) values ($1) returning id", [r.school]);
        await tx.query("insert into school_alias (school_id, name, valid_from) values ($1, $2, $3)", [
          school.id, r.school, seasons[0],
        ]);
        await tx.query("insert into program_school (program_id, school_id, from_season) values ($1, $2, $3)", [
          program.id, school.id, seasons[0],
        ]);
        programsAdded += 1;
      }

      const listed = leaguesOf.get(slug).map((x) => x.league);
      for (const season of seasons) {
        const other = await one("select league from team_season where program_id = $1 and season = $2", [program.id, season]);
        // Another league that season is refused unless this same file lists the school there too.
        if (other && other.league !== r.league && !listed.includes(other.league)) {
          throw new Error(`${r.school} is already ${other.league} in ${season}; two leagues share the slug ${slug}`);
        }
        const place = [r.league, r.division, r.region || null, r.district === "0" ? null : r.district, source.id];
        if (r.league !== listed[0]) {
          // A second league's row: the team-season stays in the first; this league is added beside it.
          const ts = await one("select id from team_season where program_id = $1 and season = $2", [program.id, season]);
          await addLeague(tx, ts.id, place, listed);
          continue;
        }
        const ts = await one(
          `insert into team_season (program_id, season, league, division, region, district, format, source_document_id)
           values ($1, $2, $3, $4, $5, $6, 6, $7)
           on conflict (program_id, season) do update set
             league = excluded.league, division = excluded.division, region = excluded.region,
             district = excluded.district, format = excluded.format, source_document_id = excluded.source_document_id
           returning id`,
          [program.id, season, ...place],
        );
        await addLeague(tx, ts.id, place, listed);
      }
    }

    await tx.query("insert into audit_log (entity, reason, after) values ('alignment_import', $1, $2)", [
      reason,
      JSON.stringify({ rows: rows.length, programsAdded, seasons }),
    ]);
    return { rows: rows.length, programsAdded };
  });
}
