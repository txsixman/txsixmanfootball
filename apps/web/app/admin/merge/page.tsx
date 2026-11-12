import { unlistedNames } from "@/lib/admin/files";
import { adminContext, loadLiveCorrections, loadLiveGames, loadLiveSchools } from "@/lib/admin/service";
import { CURRENT_SEASON } from "@/lib/season";
import { AdminNav } from "../nav";
import { MergeForm } from "../forms";
import { gate } from "../gate";

export const dynamic = "force-dynamic";

export default async function MergePage() {
  const g = await gate();
  if (!g.ok) return g.page;
  const { github } = await adminContext();
  const [schools, live] = await Promise.all([loadLiveSchools(github), loadLiveCorrections(github)]);
  // Suggestions: this season's spellings no league lists (raw names, so one already merged shows up no more).
  const unlisted = unlistedNames(await loadLiveGames(github, CURRENT_SEASON, new Map()), schools.slugs).filter((n) => !live.merges.has(n));
  return (
    <section aria-labelledby="admin-title" className="max-w-prose">
      <AdminNav />
      <h1 id="admin-title" className="font-num text-[44px] font-bold uppercase leading-none tracking-wide text-navy">Merge programs</h1>
      <p className="mt-2 text-[15px] text-muted">
        One program written two ways: every game that uses the first spelling joins the second, for the pages and the ratings.
        It does not touch the leagues&apos; own lists, and it takes effect after the next build.
      </p>
      <MergeForm unlisted={unlisted} schools={schools.names} />
    </section>
  );
}
