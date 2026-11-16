"use client";

import { MessageSquare } from "lucide-react";
import Link from "next/link";
import { useEffect, useSyncExternalStore } from "react";
import { COUNT_KEY, MAX_COUNT_KEYS } from "@/lib/posts/comment-counts";

// How many comments a game has, on its score card (ADR 0077). The pages are static, so the counts come from
// /api/games/comment-counts in the browser. Every instance on a page registers its game key; the keys are gathered in one
// tick and asked for in one request (200 at most a request), whatever the number of cards. The route answers 404 while posts
// are off and the request can fail: either way, and with no comments, nothing is drawn, so a page with posts off is as it was.
// A count is asked again only when it is more than 30 seconds old (the route's own cache is the same age), when a card is
// shown again, or when the tab comes back to the front. After a 404 nothing is asked for 5 minutes.
const FRESH_MS = 30_000;
const OFF_MS = 5 * 60_000;

const counts = new Map<string, number>();
const askedAt = new Map<string, number>();
const mounted = new Map<string, number>();
const listeners = new Set<() => void>();
let queued = false;
let offUntil = 0;

const notify = () => listeners.forEach((l) => l());

async function ask(keys: string[]) {
  try {
    const res = await fetch(`/api/games/comment-counts?keys=${keys.join(",")}`);
    if (res.status === 404) offUntil = Date.now() + OFF_MS;
    const body = res.ok ? ((await res.json()) as { counts?: Record<string, number> }) : null;
    for (const key of keys) {
      const n = body?.counts?.[key];
      if (typeof n === "number" && n > 0) counts.set(key, n);
      else counts.delete(key);
    }
  } catch {
    for (const key of keys) counts.delete(key);
  }
  notify();
}

function flush() {
  queued = false;
  const now = Date.now();
  if (now < offUntil) return;
  // Sorted, so the same cards give the same address and share the edge's cached answer.
  const keys = [...mounted.keys()].filter((k) => now - (askedAt.get(k) ?? 0) >= FRESH_MS).sort();
  for (const key of keys) askedAt.set(key, now);
  for (let i = 0; i < keys.length; i += MAX_COUNT_KEYS) void ask(keys.slice(i, i + MAX_COUNT_KEYS));
}

function schedule() {
  if (queued) return;
  queued = true;
  setTimeout(flush, 0);
}

const onVisible = () => {
  if (document.visibilityState === "visible") schedule();
};

function register(key: string): () => void {
  // A key the route would drop (an invented sample game's id) is never asked for.
  if (!COUNT_KEY.test(key)) return () => {};
  if (mounted.size === 0) document.addEventListener("visibilitychange", onVisible);
  mounted.set(key, (mounted.get(key) ?? 0) + 1);
  schedule();
  return () => {
    const left = (mounted.get(key) ?? 1) - 1;
    if (left > 0) mounted.set(key, left);
    else mounted.delete(key);
    if (mounted.size === 0) document.removeEventListener("visibilitychange", onVisible);
  };
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** The visible comments a game has: 0 while the count loads, when there are none, and when the count cannot be had. */
function useCommentCount(gameKey: string): number {
  useEffect(() => register(gameKey), [gameKey]);
  return useSyncExternalStore(
    subscribe,
    () => counts.get(gameKey) ?? 0,
    () => 0,
  );
}

const label = (n: number) => (n === 1 ? "1 comment" : `${n} comments`);
const TEXT = "items-center gap-1 text-[13px] font-semibold leading-4 text-navy";

/**
 * "1 comment" / "N comments" with a small icon, as plain text: for inside a card that is itself a link (a link in a link is not
 * valid). Nothing at all while loading, at 0, and when posts are off. `className` sets how it sits (default inline-flex).
 */
export function CommentCount({ gameKey, className = "inline-flex" }: { gameKey: string; className?: string }) {
  const n = useCommentCount(gameKey);
  if (n === 0) return null;
  return (
    <span data-comment-count={n} className={`${TEXT} ${className}`}>
      <MessageSquare aria-hidden="true" className="size-3.5 shrink-0" />
      {label(n)}
    </span>
  );
}

/** The same count as a link to the game's comments (/scores/<id>#comments), for a place that is not already a link. */
export function CommentCountLink({ gameKey, className = "inline-flex" }: { gameKey: string; className?: string }) {
  const n = useCommentCount(gameKey);
  if (n === 0) return null;
  return (
    <Link
      href={`/scores/${gameKey}#comments`}
      prefetch={false}
      data-comment-count={n}
      aria-label={`${label(n)} on this game`}
      className={`${TEXT} min-h-11 hover:underline focus-visible:outline-2 focus-visible:outline-navy ${className}`}
    >
      <MessageSquare aria-hidden="true" className="size-3.5 shrink-0" />
      {label(n)}
    </Link>
  );
}
