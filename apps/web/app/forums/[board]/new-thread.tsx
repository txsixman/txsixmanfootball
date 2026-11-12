"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { send, useMe } from "../../posts/client";
import { TEXTAREA, WhyNotForm, canPost } from "../../posts/post-parts";

/** Start a thread on a board: a title and the opening post. Signed out, a sign-in link and nothing to type into. */
export function NewThread({ board, next }: { board: string; next: string }) {
  const me = useMe();
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canPost(me)) return <WhyNotForm me={me} next={next} what="start a thread" />;

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
      <textarea id="thread-body" value={body} onChange={(e) => setBody(e.target.value)} rows={4} maxLength={2000} required className={TEXTAREA} />
      <Button type="submit" disabled={busy || title.trim() === "" || body.trim() === ""} className="self-start">{busy ? "Posting…" : "Start thread"}</Button>
      <p role="status" aria-live="polite" className="min-h-5 text-[14px] font-semibold text-red">{error}</p>
      <p className="text-[13px] leading-4 text-muted">Plain text only. No slurs or threats; links only from accounts older than 7 days.</p>
    </form>
  );
}
