"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Identity } from "@/lib/identity";
import { Crest } from "../programs/crest";

// Pagefind (MIT) indexes the built program and results-week pages after `next build` (scripts/search-index.mjs), into
// public/pagefind, under each page's real address. The index loads only when someone searches, so the page itself
// fetches nothing extra.
type Result = { url: string; title: string; excerpt: string };
type Pagefind = {
  search: (q: string) => Promise<{ results: { data: () => Promise<{ url: string; meta: { title?: string }; excerpt: string }> }[] }>;
};

const INDEX = "/pagefind/pagefind.js";
let pagefind: Promise<Pagefind> | null = null;

/** Each program's school name and look by slug, so a result for /programs/<slug> can show its crest. */
export type SearchPrograms = Record<string, { school: string; identity: Identity }>;

const programOf = (programs: SearchPrograms, url: string) => programs[/^\/programs\/([^/?#]+)\/?(?:[?#].*)?$/.exec(url)?.[1] ?? ""];

export function SearchBox({ programs }: { programs: SearchPrograms }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[] | null>(null);
  const [state, setState] = useState<"idle" | "searching" | "unavailable">("idle");
  const latest = useRef("");

  // A shared link (/search?q=jayton) runs its search on arrival.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("q");
    if (q) setQuery(q);
  }, []);

  useEffect(() => {
    const q = query.trim();
    latest.current = q;
    if (q.length < 2) {
      setResults(null);
      return;
    }
    const timer = setTimeout(async () => {
      setState("searching");
      try {
        pagefind ??= import(/* webpackIgnore: true */ /* turbopackIgnore: true */ INDEX) as Promise<Pagefind>;
        const found = await (await pagefind).search(q);
        const data = await Promise.all(found.results.slice(0, 20).map((r) => r.data()));
        if (latest.current !== q) return;
        setResults(data.map((d) => ({ url: d.url, title: d.meta.title ?? d.url, excerpt: d.excerpt })));
        setState("idle");
      } catch {
        pagefind = null;
        setState("unavailable");
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [query]);

  const status =
    state === "unavailable" ? "Search is not available right now."
      : state === "searching" ? "Searching…"
      : results === null ? "Type at least two letters."
      : `${results.length === 20 ? "20 or more" : results.length} ${results.length === 1 ? "page matches" : "pages match"}`;

  return (
    <>
      <form role="search" onSubmit={(e) => e.preventDefault()} className="mt-3 max-w-md">
        <Label htmlFor="q">Search programs and games</Label>
        <div className="relative mt-1">
          <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <Input
            id="q"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="A school, a team or a week"
            autoComplete="off"
            className="bg-accent pl-9"
          />
        </div>
      </form>
      <p role="status" className="mt-1 text-[13px] text-muted">
        {status}
      </p>
      {results && results.length > 0 && (
        <ul className="mt-4 border-t border-line">
          {results.map((r) => {
            const program = programOf(programs, r.url);
            return (
              <li key={r.url} className="border-b border-line">
                <Link href={r.url} className="flex min-h-11 items-center gap-2 px-1 py-2 hover:bg-panel">
                  {program && (
                    <span className="flex w-10 shrink-0 justify-center">
                      <Crest school={program.school} identity={program.identity} size={24} decorative />
                    </span>
                  )}
                  <span className="flex min-w-0 flex-col justify-center">
                    <span className="text-[15px] font-semibold text-navy underline-offset-2 hover:underline">{r.title}</span>
                    {/* Pagefind's excerpt: text from our own built pages, escaped, with <mark> around the matched words. */}
                    <span className="mt-0.5 text-[13px] text-muted [&_mark]:bg-transparent [&_mark]:font-semibold [&_mark]:text-ink" dangerouslySetInnerHTML={{ __html: r.excerpt }} />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
