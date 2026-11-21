# Fan database backup

ADR 0110. The Supabase project is on the free plan, which keeps no backups. Every Sunday (4:41 AM Central) the workflow **Fan
backup** (`.github/workflows/fan-backup.yml`) dumps the fan data, encrypts it with a key only the owner holds, and commits it to the
private repo `txsixman/data-private` as `backups/fan/<UTC date>.sql.age`. The newest 8 files are kept (about two months).

## What it backs up

`pg_dump --data-only` (the schema comes from the migrations) of:

- **Supabase Auth**: `auth.users` and `auth.identities` (the account behind each profile: email address, sign-in method).
- **Fan data in `public`**: `profile`, `follow`, `push_subscription`, `push_sent`, `email_optin`, `email_sent`,
  `email_unsubscribe_token`, `email_game_event`, `post` (comments and forum posts), `post_edit`, `post_flag` (reports),
  `forum_thread`, `fan_score_report`, `score_submission`, `admin_user`, `audit_log` (moderation and admin actions).
- The counters behind `audit_log` and `post_edit` ids, so new rows do not collide with restored ones.

The list lives in `.github/scripts/fan-backup.mjs` and is checked against `packages/db/migrations` on every run. A migration that
adds a table fails the run until the table is put in `FAN_TABLES` (backed up) or `NOT_BACKED_UP` (with the reason).

**Not in the backup**, on purpose:

- The sports data (schools, programs, games, brackets, ...): `packages/db/load.mjs` rebuilds it from the repo.
- `site_switch`: a restored project starts with posts and push alerts closed; open them as in `docs/fan-accounts.md`.
- Supabase project settings: the Auth URL configuration, the Google sign-in client, the custom SMTP, API keys. Re-enter them in
  the new project (`docs/fan-accounts.md`, `docs/email-alerts.md`).
- Secrets and Vercel settings.

The file is **encrypted on the runner, inside the pipe** (`pg_dump | age`): no plaintext file exists, nothing is uploaded as an
artifact, and the logs and run summary hold table names and row counts only.

## The owner's one-time steps

Until step 3 is done the workflow writes nothing and its run fails, which posts to the robot-alert issue.

1. Install age and make the key pair, on your own computer:
   ```
   brew install age
   age-keygen -o fan-backup.key
   ```
   It prints `Public key: age1...`. The file `fan-backup.key` is the **private key**: whoever has it can read every backup.
2. Keep `fan-backup.key` in your password manager (as a secure note or attachment) and one other offline place (a USB stick). Then
   delete it from the computer's folders. Never commit it, paste it into GitHub, an issue, a chat or an email. If it is lost the
   backups cannot be read, and nothing can recover them.
3. Give GitHub the **public** key only (the command reads it from the key file and prints nothing secret):
   ```
   gh variable set FAN_BACKUP_AGE_RECIPIENT -R txsixman/txsixmanfootball --body "$(age-keygen -y fan-backup.key)"
   ```
   (The secrets `SUPABASE_DB_PASSWORD` and `DATA_PRIVATE_TOKEN` are already set; the workflow uses the same ones as Supabase and
   Results watch.)
4. Prove it without writing anything. Actions, **Fan backup**, Run workflow, leave `dry_run` ticked (or
   `gh workflow run fan-backup.yml -R txsixman/txsixmanfootball -f dry_run=true`). The summary lists the rows per table and the
   encrypted size. If it says what is missing, fix that and run again.
5. Make the first real backup: Run workflow with `dry_run` unticked (or `-f dry_run=false`). Check that
   `backups/fan/<today>.sql.age` is in `txsixman/data-private`.
6. Prove you can read it (once, and again after any key change). In a clone of `data-private`:
   ```
   age -d -i /path/to/fan-backup.key backups/fan/<date>.sql.age | grep -c '^COPY'
   ```
   It prints one `COPY` statement per table (the number in step 4's summary list, 18 today), and nothing else.
7. The Sunday run is gated by the repo variable `LIVE` like the other weekly jobs. GitHub's `schedule` has not been reliable here
   (ADR 0024), so check on Monday that a Fan backup run exists; if a week passes with none, run it by hand with `dry_run` unticked.

A failed backup posts to the robot-alert issue (ADR 0027), which emails the owner.

### Changing the key

Make a new pair as in step 1, set the variable as in step 3. New backups use the new key; older files still need the older key,
so keep it until those files have rotated out (8 weeks).

## Restoring

Use this to rebuild a lost, paused-for-good or damaged project. Fans lose at most a week.

1. **A project with the schema.** Create a Supabase project (or empty the damaged one), then load it as usual, which applies every
   migration and the sports data (`CLAUDE.md`, "Load Supabase", or run the Supabase workflow). Check Auth has no users yet.
2. **Decrypt** on your own computer, from a clone of `data-private`, with the private key from your password manager:
   ```
   age -d -i /path/to/fan-backup.key backups/fan/<date>.sql.age > fan.sql
   ```
   `fan.sql` is plain text with every fan's data. Keep it off synced folders and delete it when done.
3. **Load it** into the new project as its `postgres` role (the same `PGHOST`, `PGUSER`, `PGPASSWORD` and `PGSSLROOTCERT` as the
   load), in one transaction. `session_replication_role = replica` sets foreign keys and triggers aside for this session only, which
   the restore needs because the dump is rows alone (and the append-only triggers on `audit_log` would otherwise refuse the
   truncate). The new project's own `audit_log` rows (the migrations' and the sports load's, regenerated by any later load) are cleared so
   the restored ones keep their ids:
   ```
   (echo "set session_replication_role = replica; truncate audit_log;"; cat fan.sql) | psql -v ON_ERROR_STOP=1 --single-transaction
   ```
   If it stops on an error nothing is changed; fix the cause and run it again. Run it only on a project whose Auth has no users yet.
4. **Check** the counts against the backup run's summary (rows per table), then delete the plain copy: `rm -P fan.sql` on a Mac.
5. **Re-enter the project settings** that are not in the backup (the list above), then open posts and alerts on purpose
   (`docs/fan-accounts.md`). Point the site's Supabase environment variables at the new project and redeploy. Fans sign in again
   with their emailed link or Google; their accounts, follows and posts are as of the backup.
6. Push alerts and emails resume from the restored `push_sent`, `email_sent` and `email_game_event`, so nothing already sent is
   sent twice.
