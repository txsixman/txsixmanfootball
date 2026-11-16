-- Push game alerts, dark (ADR 0082). Browser push already sends a followed program's final (ADR 0054, 0058). This adds two
-- more alerts for the same followers: a game has started (kickoff), and the next playoff game a bracket has set (pairing),
-- plus new wording for the final ("Final: <winner> 48, <loser> 12", with the game page's address). Nothing new reaches a fan
-- until the owner opens the switch, and the site's own flag (FAN_PUSH_ALERTS) has to be on too before the page shows the
-- toggle: the database half is this migration, the site half is an environment variable.
--
-- The switch is one more row of site_switch (migration 0024), closed until opened. The sender (tools/push/send-finals.mjs,
-- run by Results watch as the database owner) reads it: closed, finals go out exactly as before (old wording, program page)
-- and no kickoff or pairing is sent; open, all three are sent. A missing table or row reads as closed. To open it:
--   update site_switch set is_on = true where name = 'push_alerts';
-- and close it again with is_on = false. Every change is written to audit_log by the table's own trigger.
--
-- push_sent is the sender's memory, so an alert is sent at most once. Before sending, the sender claims each event by
-- inserting its key (`insert ... on conflict do nothing returning`): a key that is already there is never sent again, however
-- many runs see the same game. Keys are plain text built from public facts (dates and team slugs), no account, no browser:
--   kickoff|<date>|<slugA>|<slugB>                        (the two slugs sorted)
--   final|<date>|<slugA>|<slugB>|<awayScore>-<homeScore>  (a corrected score is a new final)
--   pairing|<season>|<league>|<division>|<round>|<slugA>|<slugB>
-- The sender deletes rows older than 90 days at the end of each run, so the table stays small.
--
-- Row-level security with no policy and no grant, like every table here: Supabase's API roles can neither read nor write it,
-- and there is no function that touches it. Only the owner (the sender, the SQL editor) can.

insert into site_switch (name) values ('push_alerts') on conflict (name) do nothing; -- is_on defaults to false

create table push_sent (
  event_key text primary key check (length(event_key) between 10 and 300),
  kind text not null check (kind in ('kickoff', 'final', 'pairing')),
  sent_at timestamptz not null default now()
);
alter table push_sent enable row level security;
create index push_sent_sent_at_idx on push_sent (sent_at);
comment on table push_sent is 'Push alerts already sent (ADR 0082): one row an event, claimed before sending so it goes out at most once. Owner only; rows older than 90 days are deleted by the sender.';

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on push_sent from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on push_sent from authenticated;
  end if;
end
$$;
revoke all on push_sent from public;
