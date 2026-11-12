-- Moderation core and game comments (ADR 0018). Everything here runs in the database, with no queue and no human step:
-- slurs and threats are refused before a post is saved, new accounts cannot post links and are rate-limited tighter, a
-- post flagged by 3 different established accounts is hidden, an account with 3 hidden posts in 30 days is muted, edits
-- keep every earlier version, and the owner's overrides are admin-only functions that write audit_log.
--
-- Access: row-level security on every table, no policy and no table grant. The API roles reach it only through the
-- security-definer functions below, each acting on auth.uid() (migration 0011's fan profile). Internal helpers are
-- granted to nobody. Public reads (list_comments) return a display name, the text, a time and an "edited" flag: never
-- a user id, birth year or email. packages/db/load.mjs checkLive lists every function the API roles may run.
--
-- Twins: moderation_normalize(), moderation_blocked(), post_link_count() and post_text_check() mirror
-- apps/web/lib/moderation/check.ts; the shared vectors (vectors.json) and a word-list sync test keep them equal.

-- ---------------------------------------------------------------------------------------------------------------- terms
-- The open word list (apps/web/lib/moderation/wordlist.json is the source; a later change adds a migration for it).
-- kind word: a whole word (also spelled out one letter at a time); squash: a spelling found anywhere once spaces are
-- removed (long words only); threat: a pattern on the folded, space-padded text.
create table moderation_term (
  kind text not null check (kind in ('word', 'squash', 'threat')),
  term text not null,
  primary key (kind, term)
);
alter table moderation_term enable row level security;
comment on table moderation_term is
  'Open word list for posts (ADR 0018). Slur entries from LDNOOBW (CC-BY-4.0); threat patterns written for this project.';
insert into moderation_term (kind, term) values
  ('word', 'beaner'),
  ('word', 'beaners'),
  ('word', 'bulldyke'),
  ('word', 'bulldykes'),
  ('word', 'coon'),
  ('word', 'coons'),
  ('word', 'darkie'),
  ('word', 'darkies'),
  ('word', 'fag'),
  ('word', 'faggot'),
  ('word', 'faggots'),
  ('word', 'fags'),
  ('word', 'fucktard'),
  ('word', 'fucktards'),
  ('word', 'fudge packer'),
  ('word', 'fudgepacker'),
  ('word', 'honkey'),
  ('word', 'jigaboo'),
  ('word', 'jiggaboo'),
  ('word', 'jiggerboo'),
  ('word', 'kike'),
  ('word', 'kikes'),
  ('word', 'kys'),
  ('word', 'mong'),
  ('word', 'neonazi'),
  ('word', 'nig nog'),
  ('word', 'nigga'),
  ('word', 'niggas'),
  ('word', 'niggaz'),
  ('word', 'nigger'),
  ('word', 'niggers'),
  ('word', 'paki'),
  ('word', 'pikey'),
  ('word', 'poof'),
  ('word', 'raghead'),
  ('word', 'ragheads'),
  ('word', 'shemale'),
  ('word', 'slanteye'),
  ('word', 'spastic'),
  ('word', 'spic'),
  ('word', 'spics'),
  ('word', 'towelhead'),
  ('word', 'towelheads'),
  ('word', 'trannies'),
  ('word', 'tranny'),
  ('word', 'wetback'),
  ('word', 'wetbacks'),
  ('word', 'white power'),
  ('squash', 'nigger'),
  ('squash', 'niggers'),
  ('squash', 'faggot'),
  ('squash', 'faggots'),
  ('threat', ' (?:kill|murder|shoot|stab|strangle|rape|gut|lynch) (?:you|u|ya|yall|your family|ur family) '),
  ('threat', ' (?:kill|hang|shoot|stab|strangle) (?:yourself|urself|your self|ur self) '),
  ('threat', ' (?:know|knowing) where (?:you|u|ya) (?:live|stay|sleep|park) '),
  ('threat', ' find where (?:you|u|ya) (?:live|stay) '),
  ('threat', ' (?:shoot|shooting|shot) up (?:the |this |that |your |our |their |my |a )?(?:school|stadium|game|field|gym|bleachers|crowd|place|everyone|everybody|bus|campus|team|homecoming|pep rally|football game) '),
  ('threat', ' (?:bring|brought|bringing|take|taking|took|carry|carrying) (?:a |my |the )?(?:gun|guns|rifle|knife|bomb|weapon|weapons) (?:to|into|at) (?:the |this |that |your |our |their )?(?:school|stadium|game|field|gym|practice|campus|bleachers) '),
  ('threat', ' (?:bomb|blow up) (?:the |this |that |your |our |their )?(?:school|stadium|fieldhouse|field house|gym|bus|campus) '),
  ('threat', ' (?:jump|catch|beat up) (?:you|u|ya) (?:after|outside|behind) ');

-- Compatibility forms (fullwidth letters, ligatures) split into plain ones (NFKD), lower case, apostrophes and invisible
-- characters dropped: combining marks, zero width, soft hyphen, direction changing, variation selectors, fillers.
-- Twin of strip() in check.ts.
create function moderation_strip(p_text text) returns text
language sql immutable set search_path = public, pg_temp as $$
  select regexp_replace(lower(normalize(p_text, nfkd)), '[''\u2019\u00ad\u061c\u0300-\u036f\u034f\u115f\u1160\u17b4\u17b5\u180b-\u180e\u1ab0-\u1aff\u1dc0-\u1dff\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u206f\u20d0-\u20ff\ufe00-\ufe0f\ufe20-\ufe2f\u3164\ufeff\ufff9-\ufffb\U000e0000-\U000e007f\U000e0100-\U000e01ef]', '', 'g')
$$;

-- Fold text to plain lowercase words: Cyrillic and Greek look-alikes and look-alike digits and symbols turned into
-- letters (the pairs in fold.json; before lower-casing, so the database's locale does not matter), then
-- moderation_strip(), every other run of characters a single space, three or more of one character cut to two.
-- Twin of normalize() in check.ts.
create function moderation_normalize(p_text text) returns text
language sql immutable set search_path = public, pg_temp as $$
  select btrim(
    regexp_replace(
      regexp_replace(
        moderation_strip(translate(normalize(p_text, nfkd),
          '0134578@$аАеЕоОрРсСуУхХіІјЈѕЅкКмМтТнНвВһҺԁԀԛԚԝԜӏӀαβεικνορτυχΑΒΕΖΗΙΚΜΝΟΡΤΥΧøØıłŁđĐħĦɡɑζημ',
          'oieastbasaaeeooppccyyxxiijjsskkmmtthhbbhhddqqwwllabeikvoptuxabezhikmnoptyxooillddhhgaznm')),
        '[^a-z0-9]+', ' ', 'g'),
      '([a-z0-9])\1{2,}', '\1\1', 'g'),
    ' ')
$$;

create function moderation_blocked(p_text text) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  n text := moderation_normalize(p_text);
  padded text;
  squashed text;
begin
  if n = '' then return false; end if;
  padded := ' ' || n || ' ';
  squashed := replace(n, ' ', '');
  return exists (
    select 1 from moderation_term t
     where (t.kind = 'word' and (position(' ' || t.term || ' ' in padded) > 0
            or (position(' ' in t.term) = 0 and position(' ' || regexp_replace(t.term, '(.)', '\1 ', 'g') in padded) > 0)))
        or (t.kind = 'squash' and position(t.term in squashed) > 0)
        or (t.kind = 'threat' and padded ~ t.term)
  );
end
$$;

-- A display name the word list refuses, with two more rules only names get (the sign-up round's list, kept): a few
-- terms refused anywhere in the name once look-alikes and separators are gone ("xXnaziXx"), and a few refused as a whole
-- word ("kkk"; inside other words they are harmless: "Spicewood", "Raccoon", "Chinkapin"). Read plainly and through the
-- posts' folding. Twin of nameBlocked() in names.ts.
create function moderation_name_blocked(p_name text) returns boolean
language sql stable set search_path = public, pg_temp as $$
  select moderation_blocked(p_name)
      or exists (select 1 from unnest(array['nigger', 'nigga', 'faggot', 'tranny', 'retard', 'wetback', 'nazi', 'hitler']) t(w)
                  where position(t.w in replace(moderation_normalize(p_name), ' ', '')) > 0)
      or exists (select 1
                   from (select btrim(regexp_replace(moderation_strip(p_name), '[^a-z0-9]+', ' ', 'g')) as plain, moderation_normalize(p_name) as folded) n,
                        unnest(array['fag', 'fags', 'chink', 'spic', 'kike', 'coon', 'gook', 'beaner', 'dyke', 'kkk', 'rapist']) t(w)
                  where t.w = any(string_to_array(n.plain, ' ')) or t.w = any(string_to_array(n.folded, ' ')))
$$;

-- A display name that pretends to be the site: one of these words (as a whole word, or the letters run together),
-- read plainly and read through the same folding as posts. Twin of reservedName() in names.ts.
create function moderation_reserved_name(p_name text) returns boolean
language sql immutable set search_path = public, pg_temp as $$
  select exists (
    select 1
      from (select btrim(regexp_replace(moderation_strip(p_name), '[^a-z0-9]+', ' ', 'g')) as plain, moderation_normalize(p_name) as folded) n,
           unnest(array['admin', 'administrator', 'moderator', 'mod', 'staff', 'official', 'support', 'txsixman', 'sixman', '80x40']) r(w)
     where r.w = any(string_to_array(n.plain, ' ')) or r.w = replace(n.plain, ' ', '')
        or r.w = any(string_to_array(n.folded, ' ')) or r.w = replace(n.folded, ' ', ''))
$$;

-- Sign-up's last step (migration 0011), now also refusing a display name the word list blocks or a reserved one, so the
-- site's name check (names.ts) is not the only one. Signature, age rules and grants unchanged. A name refusal carries 23514
-- (check violation, like a malformed name), never 22023, which the sign-up page reads as "under 13".
create or replace function create_profile(p_display_name text, p_birth_year int, p_turned_13 boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := auth.uid();
  age int := extract(year from now() at time zone 'America/Chicago')::int - p_birth_year;
begin
  if uid is null then
    raise exception 'create_profile: not signed in' using errcode = '42501';
  end if;
  if p_birth_year is null or age < 13 or (age = 13 and not coalesce(p_turned_13, false)) or age > 120 then
    raise exception 'create_profile: under 13' using errcode = '22023';
  end if;
  if moderation_name_blocked(p_display_name) then
    raise exception 'create_profile: name_not_allowed' using errcode = '23514';
  end if;
  if moderation_reserved_name(p_display_name) then
    raise exception 'create_profile: name_reserved' using errcode = '23514';
  end if;
  insert into profile (user_id, display_name, birth_year) values (uid, btrim(p_display_name), p_birth_year);
end
$$;

-- How many addresses a post holds, counted over the whole text (not word by word, so a bracket, a colon, an apostrophe or
-- a no-break space cannot hide one): a scheme and what follows up to a space, quote or angle bracket; a www. name; a bare
-- name ending in a common domain suffix; "dot com" spelled out. Odd spaces (no-break, en/em family, thin, narrow
-- no-break, medium mathematical, ideographic, next line, line and paragraph separators, byte order mark) are plain
-- spaces first. The same pattern finds the links the page makes clickable (splitLinks in check.ts); twin of linkCount().
create function post_link_count(p_text text) returns int
language sql immutable set search_path = public, pg_temp as $$
  select count(*)::int from regexp_matches(
    regexp_replace(p_text, '[\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]', ' ', 'g'),
    '(?:(?:https?|ftp)://[^\s<>"'']+|www\.[^\s<>"'']+|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|edu|gov|io|co|us|tv|me|ly|gg|xyz|info|app|dev|link|to|ms|cc|ru|cn|biz|site|online|shop|store|club|live|fun|top|ai|tk|ml|ga|cf|gq|ws|vip|cloud)(?![a-z0-9])|\sdot\s(?:com|net|org)(?![a-z0-9]))', 'gi')
$$;

-- The first reason a text is refused, or null. Twin of checkText() in check.ts.
create function post_text_check(p_text text, p_established boolean, p_max int default 2000) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  t text := btrim(coalesce(p_text, ''));
  links int;
begin
  -- Control characters and direction-changing ones (U+202A to U+202E, U+2066 to U+2069); nothing that folds to a letter or digit.
  if t = '' or char_length(t) > p_max or t ~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f\u202a-\u202e\u2066-\u206f]'
     or moderation_normalize(t) = '' then return 'bad_text'; end if;
  if moderation_blocked(t) then return 'blocked_text'; end if;
  links := post_link_count(t);
  -- A new account gets no address of any kind: a scheme or www. anywhere, however spaced or hidden.
  if not p_established and (links > 0 or moderation_strip(t) ~ '://|www\.') then return 'links_not_allowed'; end if;
  if links > 2 then return 'too_many_links'; end if;
  return null;
end
$$;

-- ----------------------------------------------------------------------------------------------------- who may act
-- The signed-in fan, refused if signed out, without a profile, banned, or muted now. established: the account is older
-- than 7 days. Callers: every function that posts, flags or reports. It takes a lock on the account until the
-- transaction ends, so one account's writes run one at a time: two parallel requests cannot both read the same counts
-- and each pass a rate limit or the one-score-per-game rule. Volatile, so it runs on its own snapshot after the wait.
create function fan_actor(out uid uuid, out established boolean)
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  p profile%rowtype;
begin
  uid := auth.uid();
  if uid is null then raise exception 'sign_in_required' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(uid::text, 0));
  select * into p from profile where user_id = uid;
  if not found then raise exception 'profile_required' using errcode = '42501'; end if;
  if p.banned then raise exception 'banned' using errcode = '42501'; end if;
  if p.muted_until is not null and p.muted_until > now() then raise exception 'muted' using errcode = '42501'; end if;
  established := p.created_at <= now() - interval '7 days';
end
$$;

-- Rate limits, from the callers' own tables (no outside service): the most one account may do in 10 minutes and in 24
-- hours, tighter in its first 7 days. Posts count new posts and edits. Raises rate_limited.
create function fan_rate_check(p_kind text, p_established boolean, p_recent int, p_day int) returns void
language plpgsql set search_path = public, pg_temp as $$
declare
  lim int[];
begin
  lim := case p_kind || ':' || p_established::text
    when 'post:false' then array[3, 12]
    when 'post:true' then array[8, 100]
    when 'thread:false' then array[1, 3]
    when 'thread:true' then array[3, 20]
    when 'flag:false' then array[5, 20]
    when 'flag:true' then array[10, 100]
    when 'report:false' then array[2, 6]
    when 'report:true' then array[5, 30]
  end;
  if lim is null then raise exception 'fan_rate_check: unknown kind %', p_kind; end if;
  if p_recent >= lim[1] or p_day >= lim[2] then raise exception 'rate_limited'; end if;
end
$$;

-- ----------------------------------------------------------------------------------------------------------- posts
-- One table for a comment under a game page (game_key) and a forum post (thread_id, added by migration 0015). title is
-- set only on a thread's opening post. A hidden post stays here and is never shown; cleared_at is the owner's "this one is fine".
create table post (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references profile (user_id) on delete cascade,
  game_key text check (game_key ~ '^[a-z0-9][a-z0-9-]{5,200}$'),
  thread_id uuid,
  title text check (title is null or char_length(title) between 1 and 120),
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  hidden_at timestamptz,
  cleared_at timestamptz,
  check ((game_key is null) <> (thread_id is null)),
  check (title is null or thread_id is not null)
);
create index post_game_idx on post (game_key, created_at, id) where hidden_at is null;
create index post_author_idx on post (author_id, created_at);
create index post_author_hidden_idx on post (author_id, hidden_at) where hidden_at is not null;
alter table post enable row level security;
comment on table post is 'Fans'' comments and forum posts (ADR 0018). Cascades from the fan''s profile: account deletion removes them.';

-- Every earlier version of an edited post: the version before each edit, never changed.
create table post_edit (
  id bigserial primary key,
  post_id uuid not null references post (id) on delete cascade,
  body text not null,
  title text,
  edited_at timestamptz not null default now()
);
create index post_edit_post_idx on post_edit (post_id, id);
alter table post_edit enable row level security;

-- One flag per account per post. Who counts is decided when the flags are counted (post_evaluate).
create table post_flag (
  post_id uuid not null references post (id) on delete cascade,
  flagger_id uuid not null references profile (user_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, flagger_id)
);
create index post_flag_flagger_idx on post_flag (flagger_id, created_at);
alter table post_flag enable row level security;

-- The game a /scores/<id> address names, or null. The site's addresses are the dated robot-read id
-- (<date>-<away>-at-<home>) or a playoff game's (<season>-<round>-<away>-at-<home>), built from the same program slugs
-- the database holds (the sample games and unknown addresses resolve to nothing).
create function resolve_game_key(p_key text) returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if p_key is null or p_key !~ '^[0-9]{4}-[a-z0-9-]{4,200}$' then return null; end if;
  return (
    select g.id
      from game g
      join team_season h on h.id = g.home_ts join program ph on ph.id = h.program_id
      join team_season a on a.id = g.away_ts join program pa on pa.id = a.program_id
     where ((g.playoff_round is null and g.game_date::text = left(p_key, 10))
            or (g.playoff_round is not null and g.season = left(p_key, 4)::int))
       and p_key = case when g.playoff_round is null then g.game_date::text else g.season::text || '-' || g.playoff_round end
                   || '-' || pa.slug || '-at-' || ph.slug
     limit 1);
end
$$;

-- Posts and edits by one account in the last 10 minutes and 24 hours.
create function fan_post_counts(p_uid uuid, out recent_n int, out day_n int)
language sql stable security definer set search_path = public, pg_temp as $$
  select
    (select count(*) from post where author_id = p_uid and created_at > now() - interval '10 minutes')::int
      + (select count(*) from post_edit e join post p on p.id = e.post_id where p.author_id = p_uid and e.edited_at > now() - interval '10 minutes')::int,
    (select count(*) from post where author_id = p_uid and created_at > now() - interval '24 hours')::int
      + (select count(*) from post_edit e join post p on p.id = e.post_id where p.author_id = p_uid and e.edited_at > now() - interval '24 hours')::int
$$;

-- A comment under a game page. Returns the new post's id.
create function add_comment(p_game_key text, p_body text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  a record;
  problem text;
  c record;
  new_id uuid;
begin
  select * into a from fan_actor();
  if p_game_key is null or resolve_game_key(p_game_key) is null then raise exception 'unknown_game'; end if;
  problem := post_text_check(p_body, a.established);
  if problem is not null then raise exception '%', problem; end if;
  select * into c from fan_post_counts(a.uid);
  perform fan_rate_check('post', a.established, c.recent_n, c.day_n);
  insert into post (author_id, game_key, body) values (a.uid, p_game_key, btrim(p_body)) returning id into new_id;
  return new_id;
end
$$;

-- Edit my own post. The earlier version goes to post_edit first. A hidden post cannot be edited.
create function edit_post(p_post uuid, p_body text, p_title text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  a record;
  r post%rowtype;
  problem text;
  c record;
begin
  select * into a from fan_actor();
  select * into r from post where id = p_post and author_id = a.uid for update;
  if not found then raise exception 'not_found'; end if;
  if r.hidden_at is not null then raise exception 'post_hidden'; end if;
  problem := post_text_check(p_body, a.established);
  if problem is null and r.title is not null then
    problem := post_text_check(coalesce(p_title, r.title), a.established, 120);
  end if;
  if problem is not null then raise exception '%', problem; end if;
  if btrim(p_body) = r.body and coalesce(btrim(p_title), r.title) is not distinct from r.title then return; end if;
  select * into c from fan_post_counts(a.uid);
  perform fan_rate_check('post', a.established, c.recent_n, c.day_n);
  insert into post_edit (post_id, body, title) values (r.id, r.body, r.title);
  -- The owner's "this one is fine" is for the words he read: an edit takes it back, so the new words can be flagged and hidden.
  update post set body = btrim(p_body), title = case when r.title is null then null else coalesce(btrim(p_title), r.title) end,
    edited_at = now(), cleared_at = null where id = r.id;
end
$$;

-- Hide a post once 3 different flaggers count (older than 7 days, not muted or banned, as of now); then mute its author
-- for 7 days if that is their 3rd hidden post in 30 days. A post the owner cleared is never hidden again.
create function post_evaluate(p_post uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  counted int;
  v_author uuid;
begin
  select count(distinct f.flagger_id) into counted
    from post_flag f join profile p on p.user_id = f.flagger_id
   where f.post_id = p_post and not p.banned and p.created_at <= now() - interval '7 days'
     and (p.muted_until is null or p.muted_until <= now());
  if counted < 3 then return; end if;
  update post set hidden_at = now() where id = p_post and hidden_at is null and cleared_at is null returning author_id into v_author;
  if v_author is null then return; end if;
  if (select count(*) from post where author_id = v_author and hidden_at > now() - interval '30 days') >= 3 then
    update profile set muted_until = now() + interval '7 days'
     where user_id = v_author and (muted_until is null or muted_until <= now());
  end if;
end
$$;

-- Flag a post (anyone's but my own). Takes the post's row lock so two last flags cannot both miss each other.
create function flag_post(p_post uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  a record;
  r post%rowtype;
  n_recent int;
  n_day int;
begin
  select * into a from fan_actor();
  select * into r from post where id = p_post for update;
  if not found then raise exception 'not_found'; end if;
  if r.author_id = a.uid then raise exception 'own_post'; end if;
  if r.hidden_at is not null then return; end if;
  select count(*) filter (where created_at > now() - interval '10 minutes'), count(*) into n_recent, n_day
    from post_flag where flagger_id = a.uid and created_at > now() - interval '24 hours';
  perform fan_rate_check('flag', a.established, n_recent, n_day);
  insert into post_flag (post_id, flagger_id) values (p_post, a.uid) on conflict do nothing;
  perform post_evaluate(p_post);
end
$$;

-- Public read: a game's visible comments, oldest first. No user id, birth year or email.
create function list_comments(p_game_key text, p_offset int default 0, p_limit int default 30)
returns table (id uuid, author text, body text, created_at timestamptz, edited boolean, total int)
language sql stable security definer set search_path = public, pg_temp as $$
  select p.id, pr.display_name, p.body, p.created_at, p.edited_at is not null, (count(*) over ())::int
    from post p join profile pr on pr.user_id = p.author_id
   where p.game_key = p_game_key and p.hidden_at is null and not pr.banned
   order by p.created_at, p.id
  offset greatest(coalesce(p_offset, 0), 0) limit least(greatest(coalesce(p_limit, 30), 1), 50)
$$;

-- ------------------------------------------------------------------------------------------------ the owner's overrides
-- Admin-only (is_admin(), migration 0010), each writing an audit_log row with the ids and states, never the text.
create function admin_guard() returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or not is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
end
$$;

create function admin_unhide_post(p_post uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform admin_guard();
  update post set hidden_at = null, cleared_at = now() where id = p_post and hidden_at is not null;
  if not found then raise exception 'not_found'; end if;
  insert into audit_log (actor, entity, entity_id, before, after, reason)
    values (auth.uid(), 'post', p_post, '{"hidden": true}', '{"hidden": false, "cleared": true}', left(p_reason, 500));
end
$$;

create function admin_unmute(p_user uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform admin_guard();
  update profile set muted_until = null where user_id = p_user and muted_until is not null;
  if not found then raise exception 'not_found'; end if;
  insert into audit_log (actor, entity, entity_id, before, after, reason)
    values (auth.uid(), 'profile', p_user, '{"muted": true}', '{"muted": false}', left(p_reason, 500));
end
$$;

create function admin_set_ban(p_user uuid, p_banned boolean, p_reason text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform admin_guard();
  update profile set banned = p_banned where user_id = p_user and banned is distinct from p_banned;
  if not found then raise exception 'not_found'; end if;
  insert into audit_log (actor, entity, entity_id, before, after, reason)
    values (auth.uid(), 'profile', p_user, jsonb_build_object('banned', not p_banned), jsonb_build_object('banned', p_banned), left(p_reason, 500));
end
$$;

-- What the console needs to find things to override: hidden posts (with their text) and muted or banned accounts.
create function admin_moderation_overview() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform admin_guard();
  return jsonb_build_object(
    'hidden_posts', coalesce((select jsonb_agg(h order by h.hidden_at desc) from (
        select p.id, p.author_id, pr.display_name as author, p.game_key, p.thread_id, p.title, p.body, p.hidden_at,
               (select count(*) from post_flag f where f.post_id = p.id) as flags
          from post p join profile pr on pr.user_id = p.author_id where p.hidden_at is not null
         order by p.hidden_at desc limit 200) h), '[]'),
    'restricted', coalesce((select jsonb_agg(r) from (
        select user_id, display_name, muted_until, banned from profile
         where banned or muted_until > now() order by display_name limit 200) r), '[]'));
end
$$;

-- --------------------------------------------------------------------------------------------------------- grants
revoke all on function moderation_strip(text) from public;
revoke all on function moderation_normalize(text) from public;
revoke all on function moderation_name_blocked(text) from public;
revoke all on function moderation_reserved_name(text) from public;
revoke all on function moderation_blocked(text) from public;
revoke all on function post_link_count(text) from public;
revoke all on function post_text_check(text, boolean, int) from public;
revoke all on function fan_actor() from public;
revoke all on function fan_rate_check(text, boolean, int, int) from public;
revoke all on function resolve_game_key(text) from public;
revoke all on function fan_post_counts(uuid) from public;
revoke all on function post_evaluate(uuid) from public;
revoke all on function admin_guard() from public;
revoke all on function add_comment(text, text) from public;
revoke all on function edit_post(uuid, text, text) from public;
revoke all on function flag_post(uuid) from public;
revoke all on function list_comments(text, int, int) from public;
revoke all on function admin_unhide_post(uuid, text) from public;
revoke all on function admin_unmute(uuid, text) from public;
revoke all on function admin_set_ban(uuid, boolean, text) from public;
revoke all on function admin_moderation_overview() from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') and exists (select 1 from pg_roles where rolname = 'authenticated')
     and to_regprocedure('auth.uid()') is not null then
    grant execute on function list_comments(text, int, int) to anon, authenticated;
    grant execute on function add_comment(text, text) to authenticated;
    grant execute on function edit_post(uuid, text, text) to authenticated;
    grant execute on function flag_post(uuid) to authenticated;
    grant execute on function admin_unhide_post(uuid, text) to authenticated;
    grant execute on function admin_unmute(uuid, text) to authenticated;
    grant execute on function admin_set_ban(uuid, boolean, text) to authenticated;
    grant execute on function admin_moderation_overview() to authenticated;
  end if;
end
$$;
