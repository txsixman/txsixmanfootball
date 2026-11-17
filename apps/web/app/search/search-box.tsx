"use client";

import { ArrowLeftRight, CalendarDays, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type Entry, type Hit, LIMIT, searcher, type WireIndex } from "@/lib/find";
import type { Identity } from "@/lib/identity";
import { Crest } from "../programs/crest";

// Teams, games and seasons are found instantly, in the browser, from an index the build made (lib/find-index.ts, ADR 0090):
// nothing is fetched while someone types. Weeks of results are found by Pagefind (MIT), which indexes the built results pages
// after `next build` (scripts/search-index.mjs) under each page's real address and loads only when someone searches.
type Week = { url: string; title: string; excerpt: string };
type Pagefind = {
  search: (q: string) => Promise<{ results: { data: () => Promise<{ url: string; meta: { title?: string }; excerpt: string }> }[] }>;
};

const INDEX = "/pagefind/pagefind.js";
let pagefind: Promise<Pagefind> | null = null;
const WEEKS = 8;

/** The crest a result draws: a copy sized for a 24 px crest, or the badge in the school's colors. */
const identityOf = (e: Entry): Identity => {
  const logo = e.crest.logo;
  return {
    mascot: null,
    colors: [],
    logo: logo ? { src: logo.src, small: logo.src, tiny: logo.src, large: logo.src, aspect: logo.aspect, light: logo.light } : null,
    theme: e.crest.theme,
  };
};

const ICONS = { game: ArrowLeftRight, year: CalendarDays } as const;

function Lead({ hit }: { hit: Hit }) {
  if (hit.kind === "team" || hit.kind === "season") return <Crest school={hit.entry.school} identity={identityOf(hit.entry)} size={24} decorative />;
  const Icon = ICONS[hit.kind];
  return <Icon aria-hidden="true" className="size-5 text-muted" />;
}

const row = "flex min-h-11 items-center gap-2 px-1 py-2 hover:bg-panel focus-visible:bg-panel";
const TIPS = "a town (Lubbock), a mascot (Jaybirds), the first letters of a name (CHANT, FWC), two teams (Jayton Whiteface), or a year with a team (2024 Jayton)";

export function SearchBox({ index }: { index: WireIndex }) {
  const router = useRouter();
  const find = useMemo(() => searcher(index), [index]);
  const [query, setQuery] = useState("");
  const [weeks, setWeeks] = useState<Week[]>([]);
  // The words the weeks were last looked up for: they have arrived (or the lookup failed) when it is the words now typed.
  const [weeksFor, setWeeksFor] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const latest = useRef("");

  const q = query.trim();
  const found = useMemo(() => (q.length >= 2 ? find(q) : null), [find, q]);

  // A shared link (/search?q=jayton) runs its search on arrival; a plain visit puts the cursor in the box.
  useEffect(() => {
    const shared = new URLSearchParams(window.location.search).get("q");
    if (shared) setQuery(shared);
    else input.current?.focus();
  }, []);

  // The address follows the search, so the link can be shared and Back does not lose it. The first run only reads it.
  const synced = useRef(false);
  useEffect(() => {
    if (!synced.current) {
      synced.current = true;
      return;
    }
    window.history.replaceState(null, "", q ? `?q=${encodeURIComponent(q)}` : window.location.pathname);
  }, [q]);

  // Weeks of results come from Pagefind a moment after the teams, which are already on screen.
  useEffect(() => {
    latest.current = q;
    if (q.length < 2) {
      setWeeks([]);
      setWeeksFor("");
      return;
    }
    const timer = setTimeout(async () => {
      try {
        pagefind ??= import(/* webpackIgnore: true */ /* turbopackIgnore: true */ INDEX) as Promise<Pagefind>;
        const result = await (await pagefind).search(q);
        const data = await Promise.all(result.results.slice(0, 40).map((r) => r.data()));
        if (latest.current !== q) return;
        // A program's own page is found by the index above, by name; here only the weeks, whatever else the words are in.
        setWeeks(data.filter((d) => !d.url.startsWith("/programs/")).slice(0, WEEKS).map((d) => ({ url: d.url, title: d.meta.title ?? d.url, excerpt: d.excerpt })));
        setWeeksFor(q);
      } catch {
        // No index (a dev server) or no network: the teams, games and seasons above stand without the weeks.
        pagefind = null;
        if (latest.current === q) {
          setWeeks([]);
          setWeeksFor(q);
        }
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [q]);

  const hits = found?.hits ?? [];
  const settled = weeksFor === q;
  const nothing = found !== null && hits.length === 0 && weeks.length === 0 && settled;
  const count = hits.length + weeks.length;
  const parts = [
    hits.length === 0 ? "" : found!.total > LIMIT ? `Showing the first ${LIMIT} of ${found!.total} programs` : `${hits.length} ${hits.length === 1 ? "match" : "matches"}`,
    weeks.length === 0 ? "" : `${weeks.length} ${weeks.length === 1 ? "week" : "weeks"} of results`,
  ].filter(Boolean);
  const status = found === null ? "Type at least two letters." : nothing ? "No matches." : parts.join(", ") || "Searching…";

  const links = () => [...(list.current?.querySelectorAll<HTMLAnchorElement>("a") ?? [])];
  const fromInput = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" && count > 0) {
      e.preventDefault();
      links()[0]?.focus();
    } else if (e.key === "Escape" && query) {
      setQuery("");
    }
  };
  const fromList = (e: KeyboardEvent<HTMLDivElement>) => {
    const all = links();
    const at = all.indexOf(document.activeElement as HTMLAnchorElement);
    if (at < 0 || (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Escape")) return;
    e.preventDefault();
    if (e.key === "Escape") input.current?.focus();
    else if (e.key === "ArrowDown") all[Math.min(at + 1, all.length - 1)].focus();
    else if (at === 0) input.current?.focus();
    else all[at - 1].focus();
  };

  // Results arrive after the page has drawn (a shared /search?q= link, or a search typed in), so the box keeps room for them:
  // on a phone the footer starts below the screen and does not jump down when they land (layout shift 0.51 at 375 px
  // before, Nov 16, 2026; ADR 0090 keeps it).
  return (
    <div className="min-h-[75vh]">
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          // Enter opens the best match, so a fan who knows what they typed does not have to find the list.
          const first = hits[0]?.href ?? weeks[0]?.url;
          if (first) router.push(first);
        }}
        className="mt-3 max-w-md"
      >
        <Label htmlFor="q">Search programs and games</Label>
        <div className="relative mt-1">
          <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <Input
            ref={input}
            id="q"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={fromInput}
            placeholder="School, town, mascot or two teams"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            enterKeyHint="go"
            aria-describedby="q-help"
            className="bg-accent pl-9"
          />
        </div>
        <p id="q-help" className="sr-only">
          Results appear as you type. Press Enter to open the first one, or the Down arrow to move through the list.
        </p>
      </form>
      <p role="status" className="mt-1 min-h-5 text-[13px] text-muted">
        {status}
      </p>
      {/* One keyboard handler for both lists: Up and Down walk every result link in order, Escape goes back to the box. */}
      <div ref={list} onKeyDown={fromList}>
        {hits.length > 0 && (
          <ul aria-label="Teams, games and seasons" className="mt-4 border-t border-line">
            {hits.map((hit) => (
              <li key={hit.href + hit.title} className="border-b border-line">
                <Link href={hit.href} prefetch={false} className={row}>
                  <span className="flex w-10 shrink-0 justify-center">
                    <Lead hit={hit} />
                  </span>
                  <span className="flex min-w-0 flex-col justify-center">
                    <span className="text-[15px] font-semibold text-navy underline-offset-2 hover:underline">{hit.title}</span>
                    {hit.sub && <span className="mt-0.5 text-[13px] text-muted">{hit.sub}</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {weeks.length > 0 && (
          <>
            <h2 className="mt-5 font-num text-[16px] font-bold uppercase tracking-wider text-ink">Weeks of results</h2>
            <ul aria-label="Weeks of results" className="mt-1 border-t border-line">
              {weeks.map((w) => (
                <li key={w.url} className="border-b border-line">
                  <Link href={w.url} prefetch={false} className={row}>
                    <span className="flex min-w-0 flex-col justify-center">
                      <span className="text-[15px] font-semibold text-navy underline-offset-2 hover:underline">{w.title}</span>
                      {/* Pagefind's excerpt: text from our own built pages, escaped, with <mark> around the matched words. */}
                      <span className="mt-0.5 text-[13px] text-muted [&_mark]:bg-transparent [&_mark]:font-semibold [&_mark]:text-ink" dangerouslySetInnerHTML={{ __html: w.excerpt }} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      {nothing && (
        <div className="mt-4 border border-line bg-panel px-4 py-4 text-[15px] text-ink">
          <p className="font-semibold">Nothing matches &ldquo;{q}&rdquo;.</p>
          {found?.closest && (
            <p className="mt-2">
              Did you mean{" "}
              <button type="button" onClick={() => setQuery(found.closest!.school)} className="inline-flex min-h-11 items-center font-semibold text-navy underline underline-offset-2">
                {found.closest.school}
              </button>
              ?
            </p>
          )}
          <p className="mt-2">Try {TIPS}.</p>
          <Link href="/programs" className="mt-2 inline-flex min-h-11 items-center font-semibold text-navy underline underline-offset-2">
            Browse every program
          </Link>
        </div>
      )}
    </div>
  );
}
