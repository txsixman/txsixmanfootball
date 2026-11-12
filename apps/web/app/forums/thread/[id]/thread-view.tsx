"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ForumPost } from "@/lib/forums";
import { send, useMe } from "../../../posts/client";
import { Composer, PostItem, WhyNotForm, canPost } from "../../../posts/post-parts";

/** A thread's posts for this page (edit own, flag others) and the reply box. A reply sends the reader to the page it lands on. */
export function ThreadView({ threadId, initial, replyPage, next }: { threadId: string; initial: ForumPost[]; replyPage: number; next: string }) {
  const me = useMe();
  const router = useRouter();
  const [posts, setPosts] = useState(initial);

  async function reply(text: string): Promise<string | null> {
    const r = await send("POST", "/api/fan/replies", { threadId, body: text });
    if (!r.ok) return r.message;
    router.push(`/forums/thread/${threadId}?page=${replyPage}`);
    router.refresh();
    return null;
  }

  return (
    <>
      <ul className="mt-3 border-t-2 border-navy">
        {posts.map((p) => (
          <PostItem key={p.id} post={p} me={me} onEdited={(id, body) => setPosts((all) => all.map((x) => (x.id === id ? { ...x, body, edited: true } : x)))} />
        ))}
      </ul>
      <div className="mt-4">
        {canPost(me) ? <Composer id="new-reply" label="Reply" button="Post reply" onSubmit={reply} /> : <WhyNotForm me={me} next={next} what="reply" />}
      </div>
    </>
  );
}
