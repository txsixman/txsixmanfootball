import Link from "next/link";
import { requireAdmin } from "@/lib/auth/admin";
import { fanScoreReports } from "@/lib/admin/moderation";
import { adminContext, loadLiveCorrections } from "@/lib/admin/service";
import { AdminNav } from "../nav";
import { gate } from "../gate";

export const dynamic = "force-dynamic";

export default async function CorrectionsPage() {
  const g = await gate();
  if (!g.ok) return g.page;
  const { github } = await adminContext();
  const live = await loadLiveCorrections(github);
  const { supabase } = await requireAdmin();
  const reported = await fanScoreReports(supabase);
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
      <FanReports games={reported} />
    </section>
  );
}

/**
 * Fan score reports (ADR 0061): what fans said, next to the game's own score. A report never changes a game; when one shows
 * the game's score is wrong, the fix is the game's correction form, as for any other correction.
 */
function FanReports({ games }: { games: Awaited<ReturnType<typeof fanScoreReports>> }) {
  return (
    <>
      <h2 className="mt-8 font-num text-[26px] font-bold uppercase text-navy">Fan score reports</h2>
      <p className="mt-1 text-[15px] text-muted">The last 60 days. Reports never change a score; only a correction does. &ldquo;Counting&rdquo;: from accounts older than 7 days, not banned.</p>
      {games === null ? (
        <p className="mt-2 text-[15px] font-semibold text-red">The database refused the list. Sign in again, and check that your id is in admin_user.</p>
      ) : games.length === 0 ? (
        <p className="mt-2 text-[15px]">None yet.</p>
      ) : (
        <ul className="mt-2 border-t border-line">
          {games.map((g) => (
            <li key={g.game_key} className="border-b border-line py-2 text-[15px]">
              <p className="font-semibold text-navy">{g.away} at {g.home}{g.game_date ? `, ${g.game_date}` : ""}</p>
              <p className="text-[13px] text-muted">
                {g.status === "final" && g.home_score !== null ? `Final here: ${g.away_score}-${g.home_score}` : "No final here yet"}
              </p>
              <ul className="mt-1">
                {g.scores.map((r) => (
                  <li key={`${r.home_score}-${r.away_score}`}>
                    Fans: {r.away_score}-{r.home_score} · {r.reports} {r.reports === 1 ? "report" : "reports"} ({r.counted} counting)
                    {r.disagrees && <b className="text-red"> · differs from the final</b>}
                  </li>
                ))}
              </ul>
              {g.game_date && (
                <Link href={`/admin/games/${encodeURIComponent(`${g.game_date}-${g.away}-at-${g.home}`)}`} className="text-[13px] text-navy underline">Correct this game</Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
