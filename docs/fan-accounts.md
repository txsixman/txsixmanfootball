# Fan accounts and following

ADR 0018. Fans sign in with an emailed link or Google, pick a display name and give a birth year, and can follow teams on
their account. Posts, score reports and comments come in later rounds and sit on the same profile.

Sign-in itself is the shared foundation (`apps/web/lib/auth/`, `/sign-in`, `/auth/callback`, `proxy.ts`); the admin console
uses it too (`docs/admin-console.md`). Every Supabase call is made on the server with the visitor's own session cookie
(httpOnly, so no browser client exists). Never the `service_role` key.

## The switch: FAN_SIGNIN

Fan accounts are **off by default**. With `FAN_SIGNIN` missing (or anything but exactly `on`) the site is as it was:
no "Sign in" link in the header, `/sign-in` is only the email form for accounts that already exist (the owner's way into
`/admin`; no Google button, no sign-up wording), `/account` and `/account/welcome` send everyone home, `/privacy`, `/terms` and `/account/too-young` answer 404, `/api/follows`
answers 404, the Follow button is the browser-only button, and `/api/me` answers `{ enabled: false, me: null }` without
asking Supabase (except for a request that comes from an `/admin` page). The flag is read per request on the server and
handed to the pages' scripts through `/api/me`, never a `NEXT_PUBLIC` constant: set it in Vercel and redeploy, no rebuild
of the pages is needed. Everything below describes the "on" state.

## What a fan sees

| Where | What |
|---|---|
| `/sign-in` | "Continue with Google" (whenever `FAN_SIGNIN` is on). The email link: for new fans only when `FAN_EMAIL_SIGNIN=on`; otherwise it sits behind "I already have an account" and only existing accounts get a link |
| `/account/welcome` | Last step of sign-up: display name (3 to 24 characters) and birth year. Exactly 13 years back asks "Have you had your 13th birthday?" (used once, never stored). Under 13 deletes the account at once and shows `/account/too-young`. Anyone signed in without a profile is sent here first (`/auth/callback` after sign-in, and the header from any other page) |
| `/account` | Display name, date joined, Sign out, Delete my account (a confirm step, then `delete_my_account()`), and an offer to copy this browser's follows into the account |
| `/privacy`, `/terms` | Plain language, linked from `/sign-in`, `/account/welcome` and `/account` (the site footer is `app/layout.tsx`, owned by another change: add the two links there when it is free) |
| Header | "Sign in", or the display name. Filled in by the page's own script from `/api/me`, so static pages stay static |
| Program page | The Follow button: signed out, push alerts on this browser as before; signed in, it also follows on the account (and still follows on the account where the browser cannot show alerts) |
| Home, My teams | The account's follows when signed in, else this browser's |

No age, birth year, email or school is shown anywhere. The birth year is stored in `profile.birth_year` and no function returns it.

## How it works

- **Migration 0011** `profile` (RLS, no policy, no grants) with `create_profile`, `my_profile`, `delete_my_account`.
  **Migration 0012** `follow(user_id, program_slug, created_at)`, RLS, no policy, no grants; `follow_program` (at most 100 per
  account, the slug's shape checked, a profile required), `unfollow_program`, `my_follows`, all `security definer` on `auth.uid()`'s
  own rows. `follow.user_id` references `profile` with `on delete cascade`, so deleting the account removes the follows.
  The three functions are in `SIGNED_IN_FUNCTIONS` (`packages/db/load.mjs`): CI checks anon cannot run them.
- **Server checks, then the database checks again.** Server actions and `/api/follows` validate with Zod, check the session
  (`getUser()` asks Supabase; never `getSession()`), and the database re-checks age, name shape, uniqueness, slug shape and the cap.
- `/api/me` (GET) answers `{ enabled, me }`: `enabled` is `FAN_SIGNIN`; `me` is `null` when signed out, else
  `{ displayName | null, follows, admin? }` (`null` name = sign-up unfinished; `admin` marks the owner's account, which is never
  sent to fan sign-up). No email, id or birth year. `/api/follows` (POST: follow, unfollow, import up to 100) needs a same-site
  `Origin`, a JSON body and a session. Both are in `proxy.ts`'s matcher (session refresh, `no-store`, `noindex`); the service
  worker never keeps `/api/`.
- A display name is checked by `lib/moderation/names.ts` (a small word list) before `create_profile`. The posts round replaces
  that file and keeps `displayNameProblem(name)`.
- Nothing logs an email, a birth year, a token or a Supabase error.

## Environment variables (Vercel, project `txsixmanfootball.com`, Production)

| Variable | Public? | What it is |
|---|---|---|
| `FAN_SIGNIN` | server only | `on` turns fan accounts on (everything in this document). Missing or anything else: off, see "The switch" above. Redeploy after changing |
| `FAN_EMAIL_SIGNIN` | server only | `on` (and `FAN_SIGNIN` on) lets the emailed link make NEW fan accounts. Missing or anything else: the link works for existing accounts only (it is how the owner signs in to `/admin`) and new fans see only "Continue with Google". Google is never behind it, only behind `FAN_SIGNIN`. **Turn it on after custom SMTP works** (below). Redeploy after changing |

The Supabase variables are in `docs/admin-console.md`. Google needs no variable on the site: its client id and secret live in Supabase.

## Owner's setup: Google sign-in

1. **Google Cloud.** <https://console.cloud.google.com>, signed in with the Google account that should own this. Top bar,
   project picker, New project, name it `80x40`, Create, and make sure it is the selected project.
2. **Consent screen.** Menu, APIs & Services, OAuth consent screen (it may be called Google Auth Platform; Get started).
   - App name **TX Six-Man Football**; User support email: yours; Audience/User type: **External**;
     Contact email: yours.
   - Branding, Authorized domains: add `txsixmanfootball.com` and `supabase.co`. App home page `https://txsixmanfootball.com`,
     privacy policy `https://txsixmanfootball.com/privacy`, terms `https://txsixmanfootball.com/terms`.
   - Data Access (Scopes), Add or remove scopes: tick `.../auth/userinfo.email`, `.../auth/userinfo.profile` and `openid`. These
     three need no Google review.
   - Audience: **Publish app** (move it from Testing to In production). Left in Testing only the test users you list can sign in.
3. **Make the client.** Menu, APIs & Services, Credentials (Google Auth Platform: Clients), Create credentials, OAuth client ID.
   - Application type: **Web application**; Name: `80x40 web`.
   - Authorized JavaScript origins: `https://txsixmanfootball.com`
   - Authorized redirect URIs: `https://vhgnaihnyjdnaaergtcl.supabase.co/auth/v1/callback` (exactly this: it is Supabase's address, not the site's)
   - Create. Copy the **Client ID** and **Client secret** (the secret can be shown again later; keep it in your Keychain, never in the repo or a chat).
4. **Turn it on in Supabase.** Dashboard, project `vhgnaihnyjdnaaergtcl`, Authentication, Sign In / Providers, **Google**: switch
   Enable on, paste the Client ID and Client secret, leave "Skip nonce checks" off, Save. The Callback URL it shows must equal the
   redirect URI in step 3.
5. **Check the other Supabase settings.** Authentication, Sign In / Providers, User Signups: **Allow new users to sign up**
   stays **OFF** until the day you set `FAN_SIGNIN` to `on`, and goes on in the same sitting. The anon key is public, so with
   it on anyone can make an Auth user straight through Supabase, bypassing the site's flag, age question and checks; off,
   that is closed while fan accounts are off. **Make your own admin account first** (Authentication, Users, Add user, in
   `docs/admin-console.md`), before turning signups on. Authentication, URL Configuration: Site URL
   `https://txsixmanfootball.com`; Redirect URLs contain `https://txsixmanfootball.com/auth/callback` (and
   `http://localhost:3011/auth/callback` for local tests).
6. Try it: <https://txsixmanfootball.com/sign-in>, Continue with Google, pick the account, finish sign-up.

Google signs in by the account's verified email: if you use the same email as your admin user, Supabase links the Google
sign-in to that same user, so `ADMIN_USER_ID` still matches.

## Owner's setup: email sign-up for new fans (after Resend works)

Supabase's own email sender allows about 2 emails an hour, so new-fan email sign-up stays off until the project has its own sender.

1. Resend: verify the sending domain, make an API key.
2. Supabase, Authentication, Emails, SMTP Settings: Enable custom SMTP. Host `smtp.resend.com`, port `465`, username `resend`,
   password the Resend API key, sender an address on the verified domain. Save.
3. Authentication, Emails, Templates: **Confirm signup** and **Magic Link** must both still contain `{{ .ConfirmationURL }}`
   (the defaults do). New fans get the first, existing ones the second.
4. Send yourself a sign-in link and check it arrives and works.
5. Only then set `FAN_EMAIL_SIGNIN` to `on` in Vercel (Production) and redeploy.

## Before the pages are public

`/privacy` and `/terms` give `contact@txsixmanfootball.com` for questions and copyright notices, and say "DMCA agent
registration pending". When the owner has registered the agent with the US Copyright Office (ADR 0018), change that wording on
both pages to name the agent.

## Supabase keeps copies of a user: one setting for the owner

Deleting an Auth user does not remove `auth.audit_log_entries` (a log whose payload holds the email and IP) or
`auth.flow_state` (sign-in handshakes): they have no foreign key to `auth.users`. `delete_my_account()` (migration 0012) and
the unfinished-sign-up erase delete a user's rows in both tables first, where they exist. To stop the audit log keeping new
emails and IPs at all: Supabase dashboard, project `vhgnaihnyjdnaaergtcl`, Authentication, and, if the project offers it
(under Auth settings or Auth hooks/Advanced), the setting that turns off writing auth audit logs to the database. If it is
not offered, the erase above is what clears them.

## What the accounts round did not do

- The footer links (`app/layout.tsx`) and the Follow-button screenshots: the header now ends with a "Sign in" link, so the
  CI screenshot baselines that include the header need the usual `screenshots/<anything>` branch to approve the new look.
- Push alerts stay per browser: they are not tied to the account and are not removed by deleting it (the person stops them
  with Stop alerts, or by blocking notifications).

## Unfinished sign-ups are erased

Every Supabase load (`packages/db/load.mjs`, after each push to `main` and every Monday) runs `purgeUnfinishedSignups` after
the security check: it deletes Auth users older than 7 days that have no fan profile, are not in `admin_user`, and were
created **after the first fan profile existed**. Before any fan has finished sign-up nothing is erased, so an account made
before launch (the owner's, even before his id is in `admin_user`) is never touched; make the admin account before turning
signups on. The site cannot mark who "started" fan sign-up, because anyone can create an Auth user directly through
Supabase, so the rule uses only the database. The user's `auth.flow_state` and `auth.audit_log_entries` rows go with them.
It reports a count only (`unfinishedSignupsRemoved`); a failure is reported as `purgeError` (the error code) and never fails
the load, so the security check always runs.

Not done here: reserved and slur display names enforced in the database (`create_profile`); the forums round adds them in
migration 0013. `lib/moderation/names.ts` keeps `displayNameProblem(name)` for the form.
