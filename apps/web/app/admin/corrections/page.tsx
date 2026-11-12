import { adminContext, loadLiveCorrections } from "@/lib/admin/service";
import { AdminNav } from "../nav";
import { gate } from "../gate";

export const dynamic = "force-dynamic";

export default async function CorrectionsPage() {
  const g = await gate();
  if (!g.ok) return g.page;
  const { github } = await adminContext();
  const live = await loadLiveCorrections(github);
  const rows = [
    ...live.gameRows.map((r) => ({
      key: `g-${r.game_date}-${r.home}-${r.away}-${r.corrected_on}-${r.action}-${r.home_score}-${r.away_score}`,
      on: r.corrected_on,
      title: `${r.away} at ${r.home}, ${r.game_date}`,
      what: r.action === "void" ? "Voided (listed in error)" : r.action === "forfeit" ? "Forfeit" : `Score ${r.away_score}-${r.home_score}`,
      reason: r.reason,
      url: r.source_url,
    })),
    ...live.mergeRows.map((r) => ({
      key: `m-${r.name}-${r.same_as}-${r.corrected_on}`,
      on: r.corrected_on,
      title: r.name,
      what: `Merged into ${r.same_as}`,
      reason: r.reason,
      url: r.source_url,
    })),
  ].reverse();
  return (
    <section aria-labelledby="admin-title" className="max-w-prose">
      <AdminNav />
      <h1 id="admin-title" className="font-num text-[44px] font-bold uppercase leading-none tracking-wide text-navy">Past corrections</h1>
      <p className="mt-2 text-[15px] text-muted">Live on main; the site shows a correction after its next build. A later row for the same game replaces an earlier one.</p>
      {rows.length === 0 ? (
        <p className="mt-6 text-[15px]">None yet.</p>
      ) : (
        <ul className="mt-4 border-t border-line">
          {rows.map((r) => (
            <li key={r.key} className="border-b border-line py-2 text-[15px]">
              <p className="font-semibold text-navy">{r.title}</p>
              <p>{r.what}</p>
              <p className="text-[13px] text-muted">{r.on} · {r.reason}</p>
              <a href={r.url} rel="noopener noreferrer" target="_blank" className="text-[13px] text-navy underline">Source</a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
