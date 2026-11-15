"use client";
import { type ReactNode, useEffect, useState } from "react";
import { LEVEL_LABEL, type Level } from "@/lib/standings-levels";

/**
 * The District / Area / Region switcher (ADR 0048). Every level is in the page's HTML; the one shown is the URL's
 * `?view=` (district when it names none), so a link or a reload opens the same level. A link to a district's table
 * (#d-…) opens the district level.
 */
export function LevelViews({ levels, views }: { levels: Level[]; views: Partial<Record<Level, ReactNode>> }) {
  const [view, setView] = useState<Level>(levels[0]);
  useEffect(() => {
    const read = () => {
      const asked = new URLSearchParams(window.location.search).get("view") as Level | null;
      setView(window.location.hash.startsWith("#d-") ? levels[0] : asked && levels.includes(asked) ? asked : levels[0]);
    };
    read();
    window.addEventListener("popstate", read);
    window.addEventListener("hashchange", read);
    return () => {
      window.removeEventListener("popstate", read);
      window.removeEventListener("hashchange", read);
    };
  }, [levels]);
  const choose = (level: Level) => {
    const url = level === levels[0] ? window.location.pathname : `${window.location.pathname}?view=${level}`;
    window.history.pushState(null, "", url);
    setView(level);
  };
  return (
    <>
      {levels.length > 1 && (
        <nav aria-label="Standings level" className="mt-4 flex border-b-2 border-navy">
          {levels.map((l) => (
            <a
              key={l}
              href={`?view=${l}`}
              aria-current={l === view ? "true" : undefined}
              onClick={(e) => {
                e.preventDefault();
                choose(l);
              }}
              className={`inline-flex min-h-11 flex-auto items-center justify-center px-2 whitespace-nowrap font-num text-[16px] font-bold uppercase tracking-wide ${
                l === view ? "bg-navy text-white" : "text-navy hover:bg-panel"
              }`}
            >
              {LEVEL_LABEL[l]}
            </a>
          ))}
        </nav>
      )}
      {levels.map((l) => (
        <div key={l} data-level={l} hidden={l !== view}>
          {views[l]}
        </div>
      ))}
    </>
  );
}
