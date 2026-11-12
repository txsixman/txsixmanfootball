import type { Metadata } from "next";
import { loadAlignments } from "@/lib/alignments";
import { loadIdentities } from "@/lib/identity";
import { SearchBox, type SearchPrograms } from "./search-box";

export const metadata: Metadata = { title: "Search | Project 80x40" };

export default async function SearchPage() {
  // A program result carries its school's crest (looked up by the page's address); week-of-results results have none.
  const [alignments, identities] = await Promise.all([loadAlignments(), loadIdentities()]);
  const programs: SearchPrograms = {};
  for (const a of alignments) {
    const identity = identities.get(a.slug);
    if (identity) programs[a.slug] = { school: a.school, identity };
  }
  return (
    <section aria-labelledby="search">
      <h1 id="search" className="font-num text-[56px] font-bold uppercase leading-none tracking-wide text-navy">
        Search
      </h1>
      <p className="mt-2 text-[15px] text-muted">Every program page and every week of results since 2021.</p>
      <SearchBox programs={programs} />
    </section>
  );
}
