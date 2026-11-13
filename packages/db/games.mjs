// Loads games from a CSV: hand captures and robot-read results (ADR 0008). Safe to re-run: a playoff game is matched on
// season, round and its two teams; a regular-season game (round "season") on season, date and its two teams.
// Six-man flags are reported, never enforced. An unknown team stops the whole import.

import { scoreFlags } from "../core/six-man.mjs";
import { slugify } from "./seed.mjs";

const COLUMNS = "division,round,game_date,home,away,neutral,home_score,away_score,end_reason,end_period,source_url,notes";
const REQUIRED = ["division", "round", "game_date", "home", "away", "source_url"];

export function parseGames(text) {
  const names = COLUMNS.split(",");
  const [header, ...lines] = text.trim().split("\n");
  if (header !== COLUMNS) throw new Error(`unexpected header: ${header}`);
  return lines.map((line, i) => {
    const cols = line.split(",");
    if (cols.length !== names.length) throw new Error(`bad row ${i + 2} (commas are not allowed in notes): ${line}`);
    const row = Object.fromEntries(names.map((name, j) => [name, cols[j].trim()]));
    const missing = REQUIRED.filter((name) => !row[name]);
    if (missing.length) throw new Error(`row ${i + 2} is missing ${missing.join(", ")}`);
    return row;
  });
}

/**
 * A season's team-seasons and games are read once, up front, and a game whose stored row already says the same thing
 * (score, status, site, date and source) is left alone and counted `unchanged`. Each robot-read season is ~1,100 games
 * and the CI load reruns every file; row-by-row lookups took it past its 15-minute limit (Nov 11, 2026).
 */
export async function seedGames(db, rows, { season, retrievedOn, reason }) {
  return db.transaction(async (tx) => {
    const one = async (sql, params) => (await tx.query(sql, params)).rows[0];
    const teamSeasons = new Map(
      (await tx.query("select p.slug, ts.id from team_season ts join program p on p.id = ts.program_id where ts.season = $1", [season])).rows.map(
        (r) => [r.slug, r.id],
      ),
    );
    const teamSeason = (name) => {
      const id = teamSeasons.get(slugify(name));
      if (!id) throw new Error(`unknown team for ${season}: ${name}`);
      return id;
    };
    // A playoff game is keyed on its round and two teams; a regular-season game on its date and two teams.
    const keyOf = (round, date, a, b) => [round ?? `season ${date}`, ...[a, b].sort()].join("|");
    const stored = new Map(
      (
        await tx.query(
          `select g.id, g.playoff_round, g.game_date::text as game_date, g.home_ts, g.away_ts, g.status, g.end_reason,
             g.end_period, g.home_score, g.away_score, g.neutral, s.url
           from game g left join source_document s on s.id = g.source_document_id where g.season = $1`,
          [season],
        )
      ).rows.map((g) => [keyOf(g.playoff_round, g.game_date, g.home_ts, g.away_ts), g]),
    );

    const result = { inserted: 0, updated: 0, unchanged: 0, flags: [] };
    for (const r of rows) {
      const played = r.home_score !== "";
      const home = played ? Number(r.home_score) : null;
      const away = played ? Number(r.away_score) : null;
      const params = [
        played ? "final" : "scheduled",
        played ? r.end_reason || null : null,
        r.end_period ? Number(r.end_period) : null,
        home,
        away,
        r.neutral === "true",
        r.game_date,
      ];
      if (played) {
        for (const code of scoreFlags({ home, away, endReason: r.end_reason })) {
          result.flags.push({ home: r.home, away: r.away, round: r.round, code });
        }
      }

      const [homeTs, awayTs] = [teamSeason(r.home), teamSeason(r.away)];
      // Two names for one team-season (one school on both sides) would fail the game_check constraint with no row named.
      if (homeTs === awayTs) {
        throw new Error(`season ${season}, ${r.game_date}: ${r.home} vs ${r.away} is one team on both sides; fix the capture, a game needs two teams`);
      }
      const regular = r.round === "season";
      const key = keyOf(regular ? null : r.round, r.game_date, homeTs, awayTs);
      const existing = stored.get(key);
      if (
        existing &&
        existing.url === r.source_url &&
        [existing.status, existing.end_reason, existing.end_period, existing.home_score, existing.away_score, existing.neutral, existing.game_date].every(
          (v, i) => v === params[i],
        )
      ) {
        result.unchanged += 1;
        continue;
      }
      const source = await one(
        `insert into source_document (url, retrieved_on) values ($1, $2)
         on conflict (url) do update set retrieved_on = excluded.retrieved_on returning id`,
        [r.source_url, retrievedOn],
      );

      if (existing) {
        await tx.query(
          `update game set status = $1, end_reason = $2, end_period = $3, home_score = $4, away_score = $5,
             neutral = $6, game_date = $7, source_document_id = $8 where id = $9`,
          [...params, source.id, existing.id],
        );
        Object.assign(existing, { status: params[0], end_reason: params[1], end_period: params[2], home_score: home, away_score: away, neutral: params[5], game_date: r.game_date, url: r.source_url });
        result.updated += 1;
      } else {
        const { id } = await one(
          `insert into game (status, end_reason, end_period, home_score, away_score, neutral, game_date,
             source_document_id, season, home_ts, away_ts, game_type, playoff_round)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) returning id`,
          // District or nondistrict is not known for a robot-read season game, so game_type stays empty.
          [...params, source.id, season, homeTs, awayTs, regular ? null : "playoff", regular ? null : r.round],
        );
        stored.set(key, { id, status: params[0], end_reason: params[1], end_period: params[2], home_score: home, away_score: away, neutral: params[5], game_date: r.game_date, url: r.source_url });
        result.inserted += 1;
      }
    }

    await tx.query("insert into audit_log (entity, reason, after) values ('game_import', $1, $2)", [
      reason,
      JSON.stringify(result),
    ]);
    return result;
  });
}
