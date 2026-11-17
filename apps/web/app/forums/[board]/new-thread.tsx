"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { send, useMe } from "../../posts/client";
import { TEXTAREA, WhyNotForm, canPost } from "../../posts/post-parts";

const BODY_MAX = 2000;

/**
 * Start a thread on a board: a title and the opening post. Signed out, a sign-in link and nothing to type into, except on a
 * board with no threads (`empty`), where the empty-state line carries the one sign-in link instead of a second prompt.
 */
export function NewThread({ board, next, empty = false }: { board: string; next: string; empty?: boolean }) {
  const me = useMe();
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const button = useRef<HTMLButtonElement>(null);

  // The button is disabled while posting, which drops focus; after a refusal put it back on the button, beside the message.
  useEffect(() => {
    if (error) button.current?.focus();
  }, [error]);

  if (!canPost(me)) return empty && me?.signedIn === false ? null : <WhyNotForm me={me} next={next} what="start a thread" />;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await send("POST", "/api/fan/threads", { board, title, body });
    if (r.ok && typeof r.data.id === "string") router.push(`/forums/thread/${r.data.id}`);
    else {
      setBusy(false);
      setError(r.ok ? "Something went wrong. Try again in a minute." : r.message);
    }
  }
  return (
    <form onSubmit={submit} className="flex max-w-prose flex-col gap-2">
      <Label htmlFor="thread-title">Title</Label>
      <Input id="thread-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} required />
      <Label htmlFor="thread-body">First post</Label>
      <textarea id="thread-body" value={body} onChange={(e) => setBody(e.target.value)} rows={4} maxLength={BODY_MAX} required className={TEXTAREA} />
      <div className="row-between">
        <Button ref={button} type="submit" disabled={busy || title.trim() === "" || body.trim() === ""}>{busy ? "Posting…" : "Start thread"}</Button>
        <span className="text-[13px] text-muted">{body.length} / {BODY_MAX}</span>
      </div>
      <p role="status" aria-live="polite" className="min-h-5 text-[14px] font-semibold text-red">{error}</p>
      <p className="note-13i">Plain text only. No slurs or threats; links only from accounts older than 7 days.</p>
    </form>
  );
}
