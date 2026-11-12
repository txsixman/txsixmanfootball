-- Supabase's public API roles (anon, authenticated) get no table or function rights until a later migration grants
-- them on purpose, beside a row-level security policy. Supabase's defaults left them TRUNCATE, which RLS does not stop.
-- The roles exist only on Supabase, so this does nothing on a plain Postgres (the tests' PGlite).

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') and exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on all tables in schema public from anon, authenticated;
    revoke all on all sequences in schema public from anon, authenticated;
    revoke all on all functions in schema public from anon, authenticated;
    alter default privileges in schema public revoke all on tables from anon, authenticated;
    alter default privileges in schema public revoke all on sequences from anon, authenticated;
    alter default privileges in schema public revoke all on functions from anon, authenticated;
  end if;
end
$$;
