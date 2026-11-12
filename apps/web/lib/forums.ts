import { publicClient } from "./posts/api";

// What the forum pages read: the public forum functions of migration 0015, through the anon key with no session. Every call
// returns display names, text, times and counts, never a user id, birth year or email. A failed read is an empty list
// (the page says so) and logs only the SQLSTATE.

export const THREADS_PER_PAGE = 20;
export const POSTS_PER_PAGE = 20;

export type BoardRow = { slug: string; name: string; description: string; threads: number; lastPostAt: string | null };
export type ThreadRow = { id: string; title: string; author: string; createdAt: string; lastPostAt: string; replies: number };
export type ThreadInfo = { id: string; board: string; boardName: string; title: string; total: number };
export type ForumPost = { id: string; author: string; body: string; createdAt: string; edited: boolean; joined: string };

async function read<T>(name: string, args: Record<string, unknown>): Promise<T[] | null> {
  const supabase = publicClient();
  if (!supabase) return null;
  const { data, error } = await supabase.rpc(name, args);
  if (error) {
    console.error("forums: read failed", name, error.code ?? "unknown");
    return null;
  }
  return (data ?? []) as T[];
}

/** The boards with their thread counts, or null when the database cannot be reached. */
export async function loadBoards(): Promise<BoardRow[] | null> {
  const rows = await read<{ slug: string; name: string; description: string; threads: number; last_post_at: string | null }>("forum_boards", {});
  return rows && rows.map((r) => ({ slug: r.slug, name: r.name, description: r.description, threads: r.threads, lastPostAt: r.last_post_at }));
}

export async function loadThreads(board: string, page: number): Promise<{ threads: ThreadRow[]; total: number } | null> {
  const rows = await read<{ id: string; title: string; author: string; created_at: string; last_post_at: string; replies: number; total: number }>("forum_threads", {
    p_board: board,
    p_offset: (page - 1) * THREADS_PER_PAGE,
    p_limit: THREADS_PER_PAGE,
  });
  return rows && { threads: rows.map((r) => ({ id: r.id, title: r.title, author: r.author, createdAt: r.created_at, lastPostAt: r.last_post_at, replies: r.replies })), total: rows[0]?.total ?? 0 };
}

export async function loadThread(id: string, page: number): Promise<{ info: ThreadInfo; posts: ForumPost[] } | null> {
  const info = await read<{ id: string; board: string; board_name: string; title: string; total: number }>("forum_thread_info", { p_thread: id });
  if (!info?.[0]) return null;
  const posts = await read<{ id: string; author: string; body: string; created_at: string; edited: boolean; joined: string }>("forum_posts", {
    p_thread: id,
    p_offset: (page - 1) * POSTS_PER_PAGE,
    p_limit: POSTS_PER_PAGE,
  });
  if (!posts) return null;
  const i = info[0];
  return {
    info: { id: i.id, board: i.board, boardName: i.board_name, title: i.title, total: i.total },
    posts: posts.map((p) => ({ id: p.id, author: p.author, body: p.body, createdAt: p.created_at, edited: p.edited, joined: p.joined })),
  };
}

/** A page number from a query string: a whole number from 1, else 1. */
export const pageOf = (raw: string | string[] | undefined): number => {
  const n = Number.parseInt(Array.isArray(raw) ? raw[0] : (raw ?? ""), 10);
  return Number.isFinite(n) && n >= 1 && n <= 10_000 ? n : 1;
};
