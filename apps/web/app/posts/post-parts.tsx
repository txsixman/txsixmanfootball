"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PostText } from "@/lib/posts/linkify";
import { send, when, type Me } from "./client";

// The pieces a comment and a forum post share: the byline and text, edit and flag, and the box that writes one.

export type Post = { id: string; author: string; body: string; createdAt: string; edited: boolean; joined?: string };

export const TEXTAREA =
  "block w-full border border-field bg-page px-3 py-2 text-[16px] leading-6 text-ink outline-none focus-visible:ring-2 focus-visible:ring-navy";

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
  // The status line: "Posted." in the ink color when it worked, the server's sentence in red when it did not.
  const [status, setStatus] = useState<{ text: string; error: boolean } | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setStatus(null);
    const problem = await onSubmit(text);
    setBusy(false);
    if (problem) setStatus({ text: problem, error: true });
    else {
      setText("");
      setStatus({ text: "Posted.", error: false });
      box.current?.focus(); // the button is disabled again with an empty box, so focus would otherwise be lost
    }
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <textarea
        ref={box}
        id={id}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setStatus((old) => (old?.error ? old : null));
        }}
        rows={3}
        maxLength={max}
        required
        aria-busy={busy}
        className={TEXTAREA}
      />
      <div className="flex items-center justify-between gap-3">
        <Button type="submit" disabled={busy || text.trim() === ""}>{busy ? "Posting…" : button}</Button>
        <span className="text-[13px] text-muted">{text.length} / {max}</span>
      </div>
      <p role="status" aria-live="polite" className={`min-h-5 text-[14px] font-semibold ${status?.error ? "text-red" : "text-ink"}`}>{status?.text}</p>
    </form>
  );
}

/**
 * One comment or forum post: who, when, whether it was edited, the text, Edit (own) and Report (others). Report is there for every
 * viewer (ADR 0060): signed in with a profile it flags the post; otherwise it is a link to sign in, or to finish the account, and back.
 */
export function PostItem({ post, me, next, onEdited }: { post: Post; me: Me | undefined; next: string; onEdited: (id: string, body: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(post.body);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Report asks once before it sends (ADR 0060 follow-up): a flag cannot be taken back, and a thumb mid-scroll mis-taps.
  const [confirming, setConfirming] = useState(false);
  const reportBtn = useRef<HTMLButtonElement>(null);
  const confirmBtn = useRef<HTMLButtonElement>(null);
  const noteRef = useRef<HTMLSpanElement>(null);
  const moveFocus = useRef<"confirm" | "report" | "note" | null>(null);
  useEffect(() => {
    const to = moveFocus.current;
    moveFocus.current = null;
    if (to === "confirm") confirmBtn.current?.focus();
    else if (to === "report") reportBtn.current?.focus();
    else if (to === "note") noteRef.current?.focus();
  }, [confirming, note]);
  const mine = canPost(me) && me.displayName === post.author;
  const flaggable = canPost(me) && !mine;
  // Signed out, or signed in without a profile: Report is a link (nothing is sent). While asking, or paused or banned, nothing.
  const report = !me ? null : !me.signedIn ? { href: `/sign-in?next=${encodeURIComponent(next)}`, first: "sign in first" } : !me.profile ? { href: "/account", first: "finish your account first" } : null;
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
  function askToReport() {
    moveFocus.current = "confirm";
    setConfirming(true);
  }
  function cancelReport() {
    moveFocus.current = "report";
    setConfirming(false);
  }
  async function flag() {
    setBusy(true);
    const r = await send("POST", `/api/fan/posts/${post.id}/flag`);
    setBusy(false);
    moveFocus.current = r.ok ? "note" : "report"; // the buttons are gone after a report: focus the confirmation instead of losing it
    setConfirming(false);
    setNote(r.ok ? "Reported. Thank you." : r.message);
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
      <div className="flex flex-wrap items-center gap-x-1">
        {mine && !editing && <button type="button" className={button} onClick={() => setEditing(true)}>Edit</button>}
        {flaggable && !note?.startsWith("Reported") && !confirming && (
          <button ref={reportBtn} type="button" className={button} onClick={askToReport} aria-label={`Report ${post.author}'s post`}>Report</button>
        )}
        {flaggable && confirming && (
          <div role="group" aria-label="Confirm report" className="flex flex-wrap items-center gap-x-1" onKeyDown={(e) => e.key === "Escape" && !busy && cancelReport()}>
            <span className="text-[14px] text-ink">Report this post to the moderators?</span>
            <button ref={confirmBtn} type="button" className={button} onClick={flag} disabled={busy} aria-label={`Confirm report of ${post.author}'s post`}>Report</button>
            <button type="button" className={button} onClick={cancelReport} disabled={busy}>Cancel</button>
          </div>
        )}
        {report && (
          <Link href={report.href} className={`inline-flex items-center ${button}`} aria-label={`Report ${post.author}'s post (${report.first})`}>Report</Link>
        )}
        <span ref={noteRef} tabIndex={-1} role="status" aria-live="polite" className="text-[14px] text-muted outline-none">{note}</span>
      </div>
    </li>
  );
}
