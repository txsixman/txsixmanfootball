"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { send, useMe } from "../posts/client";
import { Composer, PostItem, WhyNotForm, canPost, type Post } from "../posts/post-parts";

// Fans' comments under a game page. The page is static, so the comments load here from /api/games/<id>/comments (public,
// never cached); signed out, they are read-only with a sign-in link. Hidden comments never arrive. Posting, editing and
// flagging go through /api/fan; the database refuses banned and muted accounts and checks every rule again.
export function Comments({ gameKey }: { gameKey: string }) {
  const pathname = usePathname();
  const me = useMe();
  const [posts, setPosts] = useState<Post[]>([]);
  const [total, setTotal] = useState(0);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");

  const load = useCallback(
    async (offset: number) => {
      try {
        const r = await fetch(`/api/games/${encodeURIComponent(gameKey)}/comments?offset=${offset}`);
        if (!r.ok) throw new Error("failed");
        const data = (await r.json()) as { comments: Post[]; total: number };
        setPosts((old) => (offset === 0 ? data.comments : [...old, ...data.comments]));
        setTotal(data.total);
        setState("ready");
      } catch {
        setState("failed");
      }
    },
    [gameKey],
  );
  useEffect(() => {
    load(0);
  }, [load]);

  async function post(text: string): Promise<string | null> {
    const r = await send("POST", "/api/fan/comments", { gameKey, body: text });
    if (!r.ok) return r.message;
    await load(0);
    return null;
  }

  return (
    <section aria-labelledby="comments" className="mt-5 px-3">
      <h2 id="comments" className="mb-1 border-b-2 border-navy pb-1 font-num text-[14px] font-bold uppercase tracking-wider text-navy">
        Comments{state === "ready" && total > 0 ? ` (${total})` : ""}
      </h2>
      <div aria-live="polite">
        {state === "loading" && <p className="py-3 text-[15px] text-muted">Loading comments…</p>}
        {state === "failed" && <p className="py-3 text-[15px] text-muted">Comments could not be loaded right now.</p>}
        {state === "ready" && posts.length === 0 && <p className="py-3 text-[15px] text-muted">No comments yet.</p>}
      </div>
      {posts.length > 0 && (
        <ul>
          {posts.map((p) => (
            <PostItem key={p.id} post={p} me={me} onEdited={(id, body) => setPosts((all) => all.map((x) => (x.id === id ? { ...x, body, edited: true } : x)))} />
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
          <WhyNotForm me={me} next={pathname} what="comment" />
        )}
        <p className="mt-2 text-[13px] leading-4 text-muted">
          Plain text only. No slurs or threats; links only from accounts older than 7 days. Three flags from established accounts hide a comment.
        </p>
      </div>
    </section>
  );
}
