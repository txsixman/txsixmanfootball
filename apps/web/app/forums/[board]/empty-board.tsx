"use client";

import Link from "next/link";
import { useMe } from "../../posts/client";
import { canPost } from "../../posts/post-parts";

const LINK = "inline-flex min-h-11 items-center font-semibold text-navy underline underline-offset-2";

/**
 * What a board with no threads says. A fan who can post gets a link that moves focus to the Title field of the form above; a
 * signed-out visitor gets the one Sign in link (the form spot stays empty for them, see NewThread); anyone else, or while still
 * asking who is here, just the plain sentence (the form spot already says why they cannot post).
 */
export function EmptyBoard({ board }: { board: string }) {
  const me = useMe();
  const wrap = "flex flex-wrap items-center gap-x-1 py-1 text-[15px] text-muted";
  if (canPost(me)) {
    return (
      <p className={wrap}>
        No posts yet —{" "}
        <a
          href="#thread-title"
          className={LINK}
          onClick={(e) => {
            const title = document.getElementById("thread-title");
            if (!title) return;
            e.preventDefault();
            title.focus();
            title.scrollIntoView({ block: "center" });
          }}
        >
          start the first thread
        </a>
        .
      </p>
    );
  }
  if (me?.signedIn === false) {
    return (
      <p className={wrap}>
        No posts yet.{" "}
        <Link href={`/sign-in?next=${encodeURIComponent(`/forums/${board}`)}`} className={LINK}>Sign in</Link> to start the first thread.
      </p>
    );
  }
  return <p className="py-3 text-[15px] text-muted">No posts yet.</p>;
}
