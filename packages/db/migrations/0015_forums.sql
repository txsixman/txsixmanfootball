-- Forums (ADR 0018): a few fixed boards, a board is a list of threads, a thread is a list of posts. A thread is its
-- opening post (the `post` table of migration 0013, with a title) and its replies; hiding the opening post hides the
-- thread. Every rule of migration 0013 applies unchanged: who may post, the word list, links, rate limits, flags, hiding,
-- muting, edit history, the owner's overrides. No direct messages and no profiles: a post shows a display name and the date
-- that account joined, and nothing else.
--
-- Access as before: row-level security, no policy, no grant; the API roles use the functions below. Account deletion
-- removes the fan's posts through the profile cascade; a thread goes with its opening post.

create table forum_board (
  slug text primary key check (slug ~ '^[a-z0-9-]{2,40}$'),
  name text not null,
  description text not null,
  sort smallint not null unique
);
alter table forum_board enable row level security;
insert into forum_board (slug, name, description, sort) values
  ('general', 'General', 'Anything about Texas six-man football.', 1),
  ('uil-division-1', 'UIL Division I', 'UIL six-man Division I teams, districts and rankings.', 2),
  ('uil-division-2', 'UIL Division II', 'UIL six-man Division II teams, districts and rankings.', 3),
  ('private-schools', 'Private schools', 'TAPPS, TAIAO, TCAF and independent six-man programs.', 4),
  ('playoffs', 'Playoffs', 'Brackets, matchups and the road to the state finals.', 5);

create table forum_thread (
  id uuid primary key default gen_random_uuid(),
  board text not null references forum_board (slug),
  created_at timestamptz not null default now(),
  last_post_at timestamptz not null default now()
);
create index forum_thread_board_idx on forum_thread (board, last_post_at desc);
alter table forum_thread enable row level security;
comment on table forum_thread is 'A forum thread: no text of its own. The title is on its opening post (post.title).';

alter table post add constraint post_thread_fk foreign key (thread_id) references forum_thread (id) on delete cascade;
create index post_thread_idx on post (thread_id, created_at, id) where hidden_at is null;
-- One opening post per thread.
create unique index post_one_opening_idx on post (thread_id) where title is not null;

-- A thread goes when its opening post is deleted (the author deleted their account): its replies would have no title to hang from.
create function forum_thread_orphan() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  delete from forum_thread where id = old.thread_id;
  return old;
end
$$;
create trigger post_opening_deleted after delete on post for each row when (old.title is not null and old.thread_id is not null)
  execute function forum_thread_orphan();

-- A thread the public may see: its opening post exists, is not hidden, and its author is not banned.
create function forum_thread_visible(p_thread uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from post o join profile pr on pr.user_id = o.author_id
                  where o.thread_id = p_thread and o.title is not null and o.hidden_at is null and not pr.banned)
$$;

create function forum_boards()
returns table (slug text, name text, description text, threads int, last_post_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select b.slug, b.name, b.description,
         (select count(*) from forum_thread t where t.board = b.slug and forum_thread_visible(t.id))::int,
         (select max(t.last_post_at) from forum_thread t where t.board = b.slug and forum_thread_visible(t.id))
    from forum_board b order by b.sort
$$;

create function forum_threads(p_board text, p_offset int default 0, p_limit int default 20)
returns table (id uuid, title text, author text, created_at timestamptz, last_post_at timestamptz, replies int, total int)
language sql stable security definer set search_path = public, pg_temp as $$
  select t.id, o.title, pr.display_name, t.created_at, t.last_post_at,
         (select count(*) from post r join profile rp on rp.user_id = r.author_id
           where r.thread_id = t.id and r.title is null and r.hidden_at is null and not rp.banned)::int,
         (count(*) over ())::int
    from forum_thread t
    join post o on o.thread_id = t.id and o.title is not null and o.hidden_at is null
    join profile pr on pr.user_id = o.author_id and not pr.banned
   where t.board = p_board
   order by t.last_post_at desc, t.id
  offset greatest(coalesce(p_offset, 0), 0) limit least(greatest(coalesce(p_limit, 20), 1), 50)
$$;

create function forum_thread_info(p_thread uuid)
returns table (id uuid, board text, board_name text, title text, total int)
language sql stable security definer set search_path = public, pg_temp as $$
  select t.id, t.board, b.name, o.title,
         (select count(*) from post r join profile rp on rp.user_id = r.author_id
           where r.thread_id = t.id and r.hidden_at is null and not rp.banned)::int
    from forum_thread t
    join forum_board b on b.slug = t.board
    join post o on o.thread_id = t.id and o.title is not null and o.hidden_at is null
    join profile pr on pr.user_id = o.author_id and not pr.banned
   where t.id = p_thread
$$;

-- A thread's visible posts, opening post first, oldest first. joined: the month and year the account was made.
create function forum_posts(p_thread uuid, p_offset int default 0, p_limit int default 20)
returns table (id uuid, author text, body text, created_at timestamptz, edited boolean, joined text, total int)
language sql stable security definer set search_path = public, pg_temp as $$
  select p.id, pr.display_name, p.body, p.created_at, p.edited_at is not null,
         to_char(pr.created_at at time zone 'America/Chicago', 'Mon YYYY'), (count(*) over ())::int
    from post p join profile pr on pr.user_id = p.author_id
   where p.thread_id = p_thread and p.hidden_at is null and not pr.banned and forum_thread_visible(p_thread)
   order by (p.title is null), p.created_at, p.id
  offset greatest(coalesce(p_offset, 0), 0) limit least(greatest(coalesce(p_limit, 20), 1), 50)
$$;

-- Start a thread: the title and the opening post, checked as any post is. Returns the thread's id.
create function create_thread(p_board text, p_title text, p_body text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  a record;
  problem text;
  c record;
  n_recent int;
  n_day int;
  tid uuid;
begin
  select * into a from fan_actor();
  if not exists (select 1 from forum_board where slug = p_board) then raise exception 'unknown_board'; end if;
  problem := coalesce(post_text_check(p_title, a.established, 120), post_text_check(p_body, a.established));
  if problem is not null then raise exception '%', problem; end if;
  select * into c from fan_post_counts(a.uid);
  perform fan_rate_check('post', a.established, c.recent_n, c.day_n);
  select count(*) filter (where created_at > now() - interval '10 minutes'), count(*) into n_recent, n_day
    from post where author_id = a.uid and title is not null and created_at > now() - interval '24 hours';
  perform fan_rate_check('thread', a.established, n_recent, n_day);
  insert into forum_thread (board) values (p_board) returning id into tid;
  insert into post (author_id, thread_id, title, body) values (a.uid, tid, btrim(p_title), btrim(p_body));
  return tid;
end
$$;

-- Reply to a thread the public can see.
create function reply_to_thread(p_thread uuid, p_body text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  a record;
  problem text;
  c record;
  new_id uuid;
begin
  select * into a from fan_actor();
  if p_thread is null or not forum_thread_visible(p_thread) then raise exception 'not_found'; end if;
  problem := post_text_check(p_body, a.established);
  if problem is not null then raise exception '%', problem; end if;
  select * into c from fan_post_counts(a.uid);
  perform fan_rate_check('post', a.established, c.recent_n, c.day_n);
  insert into post (author_id, thread_id, body) values (a.uid, p_thread, btrim(p_body)) returning id into new_id;
  update forum_thread set last_post_at = now() where id = p_thread;
  return new_id;
end
$$;

revoke all on function forum_thread_orphan() from public;
revoke all on function forum_thread_visible(uuid) from public;
revoke all on function forum_boards() from public;
revoke all on function forum_threads(text, int, int) from public;
revoke all on function forum_thread_info(uuid) from public;
revoke all on function forum_posts(uuid, int, int) from public;
revoke all on function create_thread(text, text, text) from public;
revoke all on function reply_to_thread(uuid, text) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') and exists (select 1 from pg_roles where rolname = 'authenticated')
     and to_regprocedure('auth.uid()') is not null then
    grant execute on function forum_boards() to anon, authenticated;
    grant execute on function forum_threads(text, int, int) to anon, authenticated;
    grant execute on function forum_thread_info(uuid) to anon, authenticated;
    grant execute on function forum_posts(uuid, int, int) to anon, authenticated;
    grant execute on function create_thread(text, text, text) to authenticated;
    grant execute on function reply_to_thread(uuid, text) to authenticated;
  end if;
end
$$;
