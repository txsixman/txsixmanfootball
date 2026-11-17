import type { Metadata } from "next";
import { loadFindIndex } from "@/lib/find-index";
import { SearchBox } from "./search-box";
import { FIRST_SEASON } from "@/lib/season";

export const metadata: Metadata = { title: "Search", robots: { index: false } };

export default async function SearchPage() {
  // The index is built here, when the site is built (ADR 0090), and travels with the page: a team, mascot, town or two
  // teams are found as the letters are typed, with nothing to wait for.
  const index = await loadFindIndex();
  return (
    <section aria-labelledby="search">
      <h1 id="search" className="font-num text-[56px] font-bold uppercase leading-none tracking-wide text-navy">
        Search
      </h1>
      <p className="mt-2 text-[15px] text-muted">
        Every program, game and week of results since {FIRST_SEASON}. Type a school, a town, a mascot or two teams.
      </p>
      <SearchBox index={index} />
    </section>
  );
}
