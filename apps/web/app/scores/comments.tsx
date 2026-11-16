"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { pageTotal } from "@/lib/posts/total";
import { send, useMe } from "../posts/client";
import { Composer, PostItem, WhyNotForm, canPost, type Post } from "../posts/post-parts";

// Fans' comments under a game page. The page is static, so the comments load here from /api/games/<id>/comments (public,
// never cached); signed out, they are read-only with a sign-in link. Hidden comments never arrive. Posting, editing and
// flagging go through /api/fan; the database refuses banned and muted accounts and checks every rule again.
// During a game the block asks for the first page again once a minute while the tab is visible. A longer list is never moved
// under a reader's thumb: a "Show N new comments" button appears and the list changes only when it is tapped. Polling stops
// while the tab is hidden, when the route says posts are off, and after 3 failed asks in a row (until the tab is shown again).
const POLL_MS = 60_000;
const MAX_FAILS = 3;
const MAX_PAGES = 5; // a tap on "Show new" reads at most this many pages of 30

type Page = { comments: Post[]; total: number };
type Fetched = { kind: "ok"; data: Page } | { kind: "off" } | { kind: "failed" };

async function fetchPage(gameKey: string, offset: number): Promise<Fetched> {
  try {
    const r = await fetch(`/api/games/${encodeURIComponent(gameKey)}/comments?offset=${offset}`);
    if (r.status === 404) return { kind: "off" };
    if (!r.ok) return { kind: "failed" };
    return { kind: "ok", data: (await r.json()) as Page };
  } catch {
    return { kind: "failed" };
  }
}

export function Comments({ gameKey }: { gameKey: string }) {
  const pathname = usePathname();
  const me = useMe();
  const [posts, setPosts] = useState<Post[]>([]);
  const [total, setTotal] = useState(0);
  // "off": the route answers 404 while posts are off (ADR 0052), so a page built while they were on hides this block.
  const [state, setState] = useState<"loading" | "ready" | "failed" | "off">("loading");
  // The newest total the minute check has seen; more than `total` means new comments are waiting behind the button.
  const [latest, setLatest] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const here = `${pathname}#comments`; // sign-in from a comment comes back to the comments, not the top of a long page

  const load = useCallback(
    async (offset: number) => {
      const got = await fetchPage(gameKey, offset);
      if (got.kind === "off") return setState("off");
      if (got.kind === "failed") return setState("failed");
      const { data } = got;
      setPosts((old) => (offset === 0 ? data.comments : [...old, ...data.comments]));
      setTotal((known) => pageTotal(known, offset, data));
      setState("ready");
    },
    [gameKey],
  );
  useEffect(() => {
    load(0);
  }, [load]);

  // The minute check: the first page only, only while the tab is visible, nothing once posts are off or after 3 misses in a row.
  const ready = state === "ready";
  useEffect(() => {
    if (!ready) return;
    let live = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    let misses = 0;
    let asking = false;
    const stop = () => {
      clearInterval(timer);
      timer = undefined;
    };
    async function check() {
      if (asking || document.hidden || misses >= MAX_FAILS) return;
      asking = true;
      const got = await fetchPage(gameKey, 0);
      asking = false;
      if (!live) return;
      if (got.kind === "off") {
        stop();
        setState("off");
      } else if (got.kind === "failed") {
        if (++misses >= MAX_FAILS) stop();
      } else {
        misses = 0;
        setLatest(got.data.total);
      }
    }
    function start() {
      stop();
      if (!document.hidden) timer = setInterval(check, POLL_MS);
    }
    function onVisibility() {
      if (document.hidden) return stop();
      misses = 0; // a failure streak ends with the next time the tab is shown
      void check();
      start();
    }
    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      live = false;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [ready, gameKey]);

  // "Show N new comments": read the list again from the start, as far as what is on screen plus what is new (a few pages at most).
  async function showNew() {
    setRefreshing(true);
    let all: Post[] = [];
    let seen = 0;
    const want = Math.max(posts.length, latest);
    for (let i = 0; i < MAX_PAGES && all.length < want; i++) {
      const got = await fetchPage(gameKey, all.length);
      if (got.kind === "off") {
        setState("off");
        return;
      }
      if (got.kind === "failed") {
        setRefreshing(false);
        return; // the button stays, so a second tap tries again
      }
      if (got.data.comments.length === 0) break;
      all = [...all, ...got.data.comments];
      seen = got.data.total;
    }
    setPosts(all);
    setTotal(seen);
    setLatest(seen);
    setRefreshing(false);
  }

  async function post(text: string): Promise<string | null> {
    const r = await send("POST", "/api/fan/comments", { gameKey, body: text });
    if (!r.ok) return r.message;
    await load(0);
    return null;
  }

  const fresh = ready && latest > total ? latest - total : 0;
  if (state === "off") return null;
  return (
    <section aria-labelledby="comments" className="mt-5 px-3">
      <h2 id="comments" className="mb-1 border-b-2 border-navy pb-1 font-num text-[14px] font-bold uppercase tracking-wider text-navy">
        Comments{state === "ready" && total > 0 ? ` (${total})` : ""}
      </h2>
      <div aria-live="polite">
        {state === "loading" && <p className="py-3 text-[15px] text-muted">Loading comments…</p>}
        {state === "failed" && <p className="py-3 text-[15px] text-muted">Comments could not be loaded right now.</p>}
        {state === "ready" && posts.length === 0 && <p className="py-3 text-[15px] text-muted">No comments yet. Be the first.</p>}
        {fresh > 0 && (
          <Button type="button" variant="outline" className="my-2" disabled={refreshing} onClick={showNew}>
            {refreshing ? "Loading…" : `Show ${fresh} new comment${fresh === 1 ? "" : "s"}`}
          </Button>
        )}
      </div>
      {state === "ready" && posts.length === 0 && canPost(me) && (
        <button
          type="button"
          className="inline-flex min-h-11 items-center font-semibold text-navy underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-navy"
          onClick={() => document.getElementById("new-comment")?.focus()}
        >
          Write a comment
        </button>
      )}
      {posts.length > 0 && (
        <ul>
          {posts.map((p) => (
            <PostItem key={p.id} post={p} me={me} next={here} onEdited={(id, body) => setPosts((all) => all.map((x) => (x.id === id ? { ...x, body, edited: true } : x)))} />
          ))}
        </ul>
      )}
      {posts.length < total && (
        <Button type="button" variant="outline" className="mt-3" onClick={() => load(posts.length)}>Show more comments</Button>
      )}
      <div className="mt-4">
        {canPost(me) ? (
          <Composer id="new-comment" label="Add a comment" button="Post comment" onSubmit={post} />
        ) : (
          <WhyNotForm me={me} next={here} what="comment" />
        )}
        <p className="mt-2 text-[13px] leading-4 text-muted">
          Plain text only. No slurs or threats; links only from accounts older than 7 days. Three flags from established accounts hide a comment.
        </p>
      </div>
    </section>
  );
}
