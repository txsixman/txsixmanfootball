# ADR 0110: A free, encrypted weekly backup of the fan database

**Status:** Accepted Nov 21, 2026 (the owner). Builds on ADRs 0017 (the private data repo) and 0018 (fan accounts); changes no page.

## Context
- The hosted database (Supabase, free plan) keeps no backups and no point-in-time restore. The sports data in it is rebuilt from
  files in this repo and the private data repo by `packages/db/load.mjs`, so losing it costs a load. The fan data is not in any
  file: accounts, display names and birth years, follows, posts and comments, reports and moderation, push and email
  preferences. If the project were paused for good, deleted or damaged, every fan account would be gone with no way back.
- The paid plan's backups are not wanted for a free, personal project. GitHub Actions, the private repo and the tools already in
  use cost nothing.
- The data is personal: an account's email address (in Supabase Auth), a birth year, the posts a fan wrote. A backup that
  leaves the runner in the clear would be a new place for it to leak, and the code repo is public.

## Decision
- **`.github/workflows/fan-backup.yml`, weekly** (Sundays 4:41 AM Central; gated by the repo variable `LIVE` and started by hand if
  GitHub's schedule does not fire, as the other weekly jobs are, ADR 0024), plus `workflow_dispatch` with `dry_run` (the default
  by hand: dump and encrypt, report counts and size, commit nothing).
- **What it dumps** is `pg_dump --data-only` of `auth.users`, `auth.identities`, the fan-owned tables of `public` and the
  counters behind their serial columns. The schema is not dumped: a restore runs the migrations first. The list is in
  `.github/scripts/fan-backup.mjs`, every table classified either as fan data (backed up) or as rebuilt from the repo (with the
  reason), and **checked against `packages/db/migrations` on every run**: a migration that adds a table nobody classified, or a
  listed table no migration makes, fails the run before anything is dumped (`--strict-names` also fails it if the live database
  lacks one). `site_switch` is deliberately left out: a restored project starts with posts and push alerts closed and the owner
  opens them (`docs/fan-accounts.md`).
- **Encrypted before it leaves the runner.** `pg_dump` pipes into `age` with the public key in the repo variable
  `FAN_BACKUP_AGE_RECIPIENT`; no plaintext file exists, and nothing is uploaded as an artifact or printed. The private key is made
  by the owner, never enters GitHub, and is the only way to read a backup. Until the variable is set (and holds an `age1...` public
  key) the run writes nothing, says so in its summary and fails, so the robot-alert issue (ADR 0027) names it, as email-digest
  refuses without its postal address.
- **Stored in `txsixman/data-private`** as `backups/fan/<UTC date>.sql.age`, the newest 8 kept, committed by
  `TX Six-Man Football <contact@txsixmanfootball.com>` with the token the other robots use (`DATA_PRIVATE_TOKEN`, handed to git as
  a header for that call, `persist-credentials: false`). A failure posts to the robot-alert issue like every robot.
- **Logs hold table names and row counts only**: no row, email address, name or key.
- Runs as the project's `postgres` role (`SUPABASE_DB_PASSWORD`, as `supabase.yml`), because Supabase's `auth` schema is not
  readable by the narrower roles. It only reads.

## Consequences
- A lost project can be rebuilt: new project, migrations, the sports data load, then the decrypted backup (`docs/fan-backup.md`).
  Fans lose at most a week of changes.
- The owner holds the one key. Lose it and the backups are unreadable; keep it in a password manager and one other place.
  Rotating it means changing the variable; older backups still need the older key.
- Git history keeps each week's file after it leaves the tree (the newest 8 are what is in the tree). Encrypted files do not
  compress, so history grows by the dump's size a week; at this data's size that is years of room. If the private repo ever
  nears its size limit, squash its history.
- A backup is not restore-tested by the workflow (it cannot decrypt). The owner's restore drill in `docs/fan-backup.md` is the proof.
- A new table is a decision at the time: the run fails until it is put in one list or the other.
