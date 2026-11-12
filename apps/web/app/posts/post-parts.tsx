"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PostText } from "@/lib/posts/linkify";
import { send, when, type Me } from "./client";

// The pieces a comment and a forum post share: the byline and text, edit and flag, and the box that writes one.

export type Post = { id: string; author: string; body: string; createdAt: string; edited: boolean; joined?: string };

export const TEXTAREA =
  "block w-full border border-line bg-white px-3 py-2 text-[16px] leading-6 text-ink outline-none focus-visible:ring-2 focus-visible:ring-navy";

/** What a signed-in person may do on a page, from /api/fan/me. */
export const canPost = (me: Me | undefined): me is Extract<Me, { profile: true }> => me?.signedIn === true && "profile" in me && me.profile && me.canPost;

/** The line a visitor sees in place of a form: sign in, finish the profile, or paused. Nothing while still asking. */
export function WhyNotForm({ me, next, what }: { me: Me | undefined; next: string; what: string }) {
  if (!me || (me.signedIn && me.profile && me.canPost)) return null;
  const link = "inline-flex min-h-11 items-center font-semibold text-navy underline underline-offset-2";
  if (!me.signedIn) {
    return (
      <p className="flex flex-wrap items-center gap-x-1 text-[15px] text-ink">
        <Link href={`/sign-in?next=${encodeURIComponent(next)}`} className={link}>Sign in</Link> to {what}.
      </p>
    );
  }
  if (!me.profile) {
    return (
      <p className="flex flex-wrap items-center gap-x-1 text-[15px] text-ink">
        <Link href="/account" className={link}>Finish setting up your account</Link> to {what}.
      </p>
    );
  }
  return <p className="text-[15px] text-ink">{me.banned ? "This account cannot post." : "Your account is paused from posting for now."}</p>;
}

/** A box and a button. `onSubmit` returns an error sentence, or null when it worked (the box then clears). */
export function Composer({ id, label, button, max = 2000, onSubmit }: { id: string; label: string; button: string; max?: number; onSubmit: (text: string) => Promise<string | null> }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const problem = await onSubmit(text);
    setBusy(false);
    if (problem) setError(problem);
    else setText("");
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <textarea id={id} value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={max} required className={TEXTAREA} />
      <div className="flex items-center justify-between gap-3">
        <Button type="submit" disabled={busy || text.trim() === ""}>{busy ? "Posting…" : button}</Button>
        <span className="text-[13px] text-muted">{text.length} / {max}</span>
      </div>
      <p role="status" aria-live="polite" className="min-h-5 text-[14px] font-semibold text-red">{error}</p>
    </form>
  );
}

/** One comment or forum post: who, when, whether it was edited, the text, and for a signed-in person Edit (own) or Flag (others). */
export function PostItem({ post, me, onEdited }: { post: Post; me: Me | undefined; onEdited: (id: string, body: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(post.body);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mine = canPost(me) && me.displayName === post.author;
  const flaggable = canPost(me) && !mine;
  const button = "min-h-11 px-2 text-[14px] font-semibold text-navy underline underline-offset-2 disabled:opacity-60";

  async function save() {
    setBusy(true);
    const r = await send("PATCH", `/api/fan/posts/${post.id}`, { body: draft });
    setBusy(false);
    if (r.ok) {
      onEdited(post.id, draft.trim());
      setEditing(false);
      setNote(null);
    } else setNote(r.message);
  }
  async function flag() {
    setBusy(true);
    const r = await send("POST", `/api/fan/posts/${post.id}/flag`);
    setBusy(false);
    setNote(r.ok ? "Flagged. Thank you." : r.message);
  }

  return (
    <li className="border-b border-line py-3">
      <p className="text-[13px] text-muted">
        <b className="text-ink">{post.author}</b>
        {post.joined ? ` · joined ${post.joined}` : ""} · <time dateTime={post.createdAt}>{when(post.createdAt)}</time>
        {post.edited && <span> · edited</span>}
      </p>
      {editing ? (
        <div className="mt-1 flex flex-col gap-2">
          <Label htmlFor={`edit-${post.id}`} className="sr-only">Edit your post</Label>
          <textarea id={`edit-${post.id}`} value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} maxLength={2000} className={TEXTAREA} />
          <div className="flex gap-2">
            <Button type="button" onClick={save} disabled={busy || draft.trim() === ""}>Save</Button>
            <Button type="button" variant="outline" onClick={() => { setEditing(false); setDraft(post.body); setNote(null); }}>Cancel</Button>
          </div>
        </div>
      ) : (
        <div className="mt-1"><PostText text={post.body} /></div>
      )}
      <div className="flex items-center gap-1">
        {mine && !editing && <button type="button" className={button} onClick={() => setEditing(true)}>Edit</button>}
        {flaggable && !note?.startsWith("Flagged") && (
          <button type="button" className={button} onClick={flag} disabled={busy} aria-label={`Flag ${post.author}'s post`}>Flag</button>
        )}
        <span role="status" aria-live="polite" className="text-[14px] text-muted">{note}</span>
      </div>
    </li>
  );
}
