import assert from "node:assert/strict";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { checkLive, migrate } from "../load.mjs";

// Supabase hands its API roles rights on every new table by default; after the migrations they must hold none.
test("Supabase's API roles hold no rights on any table after the migrations, but SELECT on live_score", async () => {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on functions to anon, authenticated;`);
  await migrate(db);
  const { rows } = await db.query(
    `select grantee, table_name, privilege_type from information_schema.role_table_grants
       where table_schema = 'public' and grantee in ('anon', 'authenticated') order by grantee, table_name, privilege_type`,
  );
  // The one table they may read: live scores (0016, ADR 0021), SELECT only.
  assert.deepEqual(rows, [
    { grantee: "anon", table_name: "live_score", privilege_type: "SELECT" },
    { grantee: "authenticated", table_name: "live_score", privilege_type: "SELECT" },
  ]);
  // A table a later migration adds gets nothing by default either.
  await db.exec("create table later (id int)");
  const later = await db.query("select 1 from information_schema.role_table_grants where table_name = 'later' and grantee = 'anon'");
  assert.equal(later.rows.length, 0);

  // The live check the loader runs after every load: clean now, then it names both kinds of fault.
  await db.exec("alter table later enable row level security");
  assert.deepEqual(await checkLive(db), []);
  await db.exec("create table leaky (id int); grant select on leaky to anon");
  assert.deepEqual(await checkLive(db), ["public.leaky has no row-level security", "anon holds SELECT on public.leaky"]);
});
