import Link from "next/link";
import { requireAdmin } from "@/lib/auth/admin";
import { moderationOverview } from "@/lib/admin/moderation";
import { AdminNav } from "../nav";
import { gate } from "../gate";
import { ModerateForm } from "./forms";

export const dynamic = "force-dynamic";

const when = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "medium", timeStyle: "short" });

/** The owner's overrides (ADR 0018): hidden posts to show again, and muted or banned accounts. */
export default async function ModerationPage() {
  const g = await gate();
  if (!g.ok) return g.page;
  const { supabase } = await requireAdmin();
  const overview = await moderationOverview(supabase);
  return (
    <section aria-labelledby="admin-title" className="max-w-prose">
      <AdminNav />
      <h1 id="admin-title" className="font-num text-[44px] font-bold uppercase leading-none tracking-wide text-navy">Moderation</h1>
      <p className="mt-2 text-[15px] text-muted">Posts hide themselves after enough flags; accounts mute after three hidden posts in 30 days. Every change here goes in the audit log with your reason.</p>
      {!overview ? (
        <p className="mt-6 text-[15px] font-semibold text-red">The database refused the list. Sign in again, and check that your id is in admin_user.</p>
      ) : (
        <>
          <h2 className="mt-8 font-num text-[26px] font-bold uppercase text-navy">Hidden posts</h2>
          {overview.hidden_posts.length === 0 ? (
            <p className="mt-2 text-[15px]">None.</p>
          ) : (
            <ul className="mt-2 border-t border-line">
              {overview.hidden_posts.map((p) => (
                <li key={p.id} className="border-b border-line py-3 text-[15px]">
                  <p className="text-[13px] text-muted">
                    {p.author} · {when(p.hidden_at)} · {p.flags} {p.flags === 1 ? "flag" : "flags"} ·{" "}
                    {p.game_key ? (
                      <Link href={`/scores/${encodeURIComponent(p.game_key)}`} className="text-navy underline">Game comment</Link>
                    ) : p.thread_id ? (
                      <Link href={`/forums/thread/${encodeURIComponent(p.thread_id)}`} className="text-navy underline">Forum post</Link>
                    ) : (
                      "Post"
                    )}
                  </p>
                  {p.title && <p className="font-semibold text-navy">{p.title}</p>}
                  <p className="whitespace-pre-wrap break-words">{p.body}</p>
                  <ModerateForm op="unhide" id={p.id} label="Show again" />
                  <ModerateForm op="ban" id={p.author_id} label={`Ban ${p.author}`} />
                </li>
              ))}
            </ul>
          )}
          <h2 className="mt-8 font-num text-[26px] font-bold uppercase text-navy">Muted or banned</h2>
          {overview.restricted.length === 0 ? (
            <p className="mt-2 text-[15px]">None.</p>
          ) : (
            <ul className="mt-2 border-t border-line">
              {overview.restricted.map((r) => (
                <li key={r.user_id} className="border-b border-line py-3 text-[15px]">
                  <p className="font-semibold text-navy">{r.display_name}</p>
                  <p className="text-[13px] text-muted">
                    {r.banned ? "Banned" : r.muted_until ? `Muted until ${when(r.muted_until)}` : ""}
                  </p>
                  {r.muted_until && !r.banned && <ModerateForm op="unmute" id={r.user_id} label="Lift mute" />}
                  {r.banned ? <ModerateForm op="unban" id={r.user_id} label="Lift ban" /> : <ModerateForm op="ban" id={r.user_id} label="Ban" />}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
