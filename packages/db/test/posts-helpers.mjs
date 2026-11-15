import { PGlite } from "@electric-sql/pglite";
import { parseGames, seedGames } from "../games.mjs";
import { migrate } from "../load.mjs";
import { seedAlignments } from "../seed.mjs";

// Shared setup for the posts tests (migrations 0013 to 0015, 0024): Supabase's roles and auth.uid(), a database with two
// teams and two games, and fans made through create_profile like the real sign-up.
export const ADMIN = "11111111-1111-4111-8111-111111111111";
export const YEAR = Number(new Intl.DateTimeFormat("en-US", { year: "numeric", timeZone: "America/Chicago" }).format(new Date()));
const HEADER = "division,round,game_date,home,away,neutral,home_score,away_score,end_reason,end_period,source_url,notes";
const SRC = "https://example.test/bracket";

/** A playoff game page's key, a regular season game's key (both unplayed), and a game already played. */
export const KEYS = { playoff: "2026-bi-district-beta-at-alpha", regular: "2026-09-04-beta-at-alpha", played: "2026-09-11-alpha-at-beta" };

/** `posts`: the posts switch (migration 0024, closed on a fresh database) is opened, quietly, so the tests can post. Pass false to test it closed. */
export async function db({ games = true, posts = true } = {}) {
  const d = new PGlite();
  await d.exec(`create role anon; create role authenticated;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;`);
  await migrate(d);
  if (posts) await d.exec("alter table site_switch disable trigger site_switch_change; update site_switch set is_on = true where name = 'posts'; alter table site_switch enable trigger site_switch_change");
  await d.query("insert into admin_user (user_id) values ($1)", [ADMIN]);
  if (games) {
    const rows = ["Alpha", "Beta"].map((school) => ({ league: "TEST", division: "I", district: "1", school, source_url: SRC }));
    await seedAlignments(d, rows, { seasons: [2026], retrievedOn: "2026-11-10", reason: "test" });
    const lines = [
      `I,bi-district,2026-11-13,Alpha,Beta,true,,,,,${SRC},`,
      `I,season,2026-09-04,Alpha,Beta,false,,,,,${SRC},`,
      `I,season,2026-09-11,Beta,Alpha,false,21,14,regulation,,${SRC},`,
    ];
    await seedGames(d, parseGames([HEADER, ...lines].join("\n")), { season: 2026, retrievedOn: "2026-11-14", reason: "test" });
  }
  return d;
}

export const as = (d, role, sub) => d.exec(`reset role; select set_config('request.jwt.claim.sub', '${sub ?? ""}', false); set role ${role}`);
export const asFan = (d, id) => as(d, "authenticated", id);

let counter = 0;
/** A new user id (a valid UUID), different every call. */
export const newId = () => `aaaaaaaa-0000-4000-8000-${String(++counter).padStart(12, "0")}`;

/** A fan made through create_profile. `old`: the account is 8 days old (established), set by hand as nothing else can. */
export async function fan(d, name, { old = true, muted = false } = {}) {
  const id = newId();
  await asFan(d, id);
  await d.query("select create_profile($1, $2, false)", [name, YEAR - 30]);
  await d.exec("reset role");
  if (old) await d.query("update profile set created_at = now() - interval '8 days' where user_id = $1", [id]);
  if (muted) await d.query("update profile set muted_until = now() + interval '1 day' where user_id = $1", [id]);
  return id;
}

/** Many established fans: ids only. */
export async function fans(d, n, prefix = "Fan") {
  const ids = [];
  for (let i = 0; i < n; i++) ids.push(await fan(d, `${prefix} ${String.fromCharCode(65 + (counter % 26))}${i}${counter}`));
  return ids;
}

/** Runs `sql` as the superuser, then returns to the API role the test was using. */
export const sudo = async (d, sql, params) => {
  await d.exec("reset role");
  return d.query(sql, params);
};

/**
 * Moves the last minute's posts, edits, flags and score reports by these accounts 61 seconds back, so a test can make more
 * than the per-minute limit allows (migration 0027) and still test the 10-minute and 24-hour ones. Leaves the role reset.
 */
export async function cool(d, ...ids) {
  await d.exec("reset role");
  const back = "interval '61 seconds'";
  const recent = "> now() - interval '1 minute'";
  await d.query(`update post set created_at = created_at - ${back} where author_id = any($1) and created_at ${recent}`, [ids]);
  await d.query(`update post_edit e set edited_at = e.edited_at - ${back} from post p where p.id = e.post_id and p.author_id = any($1) and e.edited_at ${recent}`, [ids]);
  await d.query(`update post_flag set created_at = created_at - ${back} where flagger_id = any($1) and created_at ${recent}`, [ids]);
  await d.exec("alter table fan_score_report disable trigger fan_score_report_no_edit");
  await d.query(`update fan_score_report set reported_at = reported_at - ${back} where reporter_id = any($1) and reported_at ${recent}`, [ids]);
  await d.exec("alter table fan_score_report enable trigger fan_score_report_no_edit");
}
