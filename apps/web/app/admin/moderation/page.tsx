import Link from "next/link";
import { fanPosts } from "@/lib/auth/config";
import { requireAdmin } from "@/lib/auth/admin";
import { moderationOverview, recentPosts } from "@/lib/admin/moderation";
import { AdminNav } from "../nav";
import { gate } from "../gate";
import { ModerateForm } from "./forms";

export const dynamic = "force-dynamic";

/** Where a post is: a link while posts are on, plain text while the forum and game pages answer 404. */
function Where({ p, postsOn }: { p: { game_key: string | null; thread_id: string | null }; postsOn: boolean }) {
  if (p.game_key) return postsOn ? <Link href={`/scores/${encodeURIComponent(p.game_key)}`} className="text-navy underline">Game comment</Link> : "Game comment";
  if (p.thread_id) return postsOn ? <Link href={`/forums/thread/${encodeURIComponent(p.thread_id)}`} className="text-navy underline">Forum post</Link> : "Forum post";
  return "Post";
}

const when = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "medium", timeStyle: "short" });

/**
 * The owner's overrides (ADRs 0018, 0061, 0085): reported posts to hide, every recent post (reported or not) to hide, hidden
 * posts to show again, and accounts to mute, ban or
 * let back. Behind the admin gate, so not a
 * public page: it stays open while posts are off (FAN_POSTS, ADR 0052), because cleaning up and banning must work whichever way
 * the switch is set. It then says so, and shows a post's place as plain text, since the forum and game pages answer 404.
 */
export default async function ModerationPage() {
  const g = await gate();
  if (!g.ok) return g.page;
  const { supabase } = await requireAdmin();
  const [overview, recent] = await Promise.all([moderationOverview(supabase), recentPosts(supabase)]);
  const postsOn = fanPosts();
  return (
    <section aria-labelledby="admin-title" className="max-w-prose">
      <AdminNav />
      <h1 id="admin-title" className="font-num text-[44px] font-bold uppercase leading-none tracking-wide text-navy">Moderation</h1>
      <p className="mt-2 text-[15px] text-muted">Posts hide themselves after enough reports; accounts mute after three hidden posts in 30 days. Nothing here waits on you. Every change here goes in the audit log with your reason.</p>
      {!postsOn && (
        <p className="mt-2 text-[15px] font-semibold text-navy">Posts are switched off on the site (FAN_POSTS), so the forum and game pages are closed. This page still works.</p>
      )}
      {!overview ? (
        <p className="mt-6 text-[15px] font-semibold text-red">The database refused the list. Sign in again, and check that your id is in admin_user.</p>
      ) : (
        <>
          <h2 className="mt-8 font-num text-[26px] font-bold uppercase text-navy">Reported posts</h2>
          <p className="mt-1 text-[13px] text-muted">Flagged and still showing, most reports first. Three reports from accounts older than 7 days hide a post on their own; the rest are here for you to judge.</p>
          {overview.flagged_posts.length === 0 ? (
            <p className="mt-2 text-[15px]">None.</p>
          ) : (
            <ul className="mt-2 border-t border-line">
              {overview.flagged_posts.map((p) => (
                <li key={p.id} className="border-b border-line py-3 text-[15px]">
                  <p className="text-[13px] text-muted">
                    {p.author} · {when(p.created_at)} · {p.flags} {p.flags === 1 ? "report" : "reports"} ({p.counted} counting) · <Where p={p} postsOn={postsOn} />
                  </p>
                  {p.title && <p className="font-semibold text-navy">{p.title}</p>}
                  <p className="whitespace-pre-wrap break-words">{p.body}</p>
                  <ModerateForm op="hide" id={p.id} label="Hide" />
                  <ModerateForm op="mute" id={p.author_id} scope={p.id} label={`Mute ${p.author}`} />
                  <ModerateForm op="ban" id={p.author_id} scope={p.id} label={`Ban ${p.author}`} />
                </li>
              ))}
            </ul>
          )}
          <h2 className="mt-8 font-num text-[26px] font-bold uppercase text-navy">Recent posts</h2>
          <p className="mt-1 text-[13px] text-muted">Every post still showing from the last 7 days, newest first (at most 100), reported or not, so you can hide one nobody reported.</p>
          {recent === "missing" ? (
            <p data-testid="recent-missing" className="mt-2 text-[15px]">Not on the database yet: it needs migration 0032.</p>
          ) : recent === null ? (
            <p className="mt-2 text-[15px] font-semibold text-red">The database refused this list. Try again in a minute.</p>
          ) : recent.length === 0 ? (
            <p className="mt-2 text-[15px]">None.</p>
          ) : (
            <ul data-testid="recent-posts" className="mt-2 border-t border-line">
              {recent.map((p) => (
                <li key={p.id} className="border-b border-line py-3 text-[15px]">
                  <p className="text-[13px] text-muted">
                    {p.author} · {when(p.created_at)} · {p.flags} {p.flags === 1 ? "report" : "reports"} · <Where p={p} postsOn={postsOn} />
                  </p>
                  {p.title && <p className="font-semibold text-navy">{p.title}</p>}
                  <p className="whitespace-pre-wrap break-words">{p.body}</p>
                  <ModerateForm op="hide" id={p.id} scope="recent" label="Hide" />
                  <ModerateForm op="mute" id={p.author_id} scope={`recent-${p.id}`} label={`Mute ${p.author}`} />
                  <ModerateForm op="ban" id={p.author_id} scope={`recent-${p.id}`} label={`Ban ${p.author}`} />
                </li>
              ))}
            </ul>
          )}
          <h2 className="mt-8 font-num text-[26px] font-bold uppercase text-navy">Hidden posts</h2>
          {overview.hidden_posts.length === 0 ? (
            <p className="mt-2 text-[15px]">None.</p>
          ) : (
            <ul className="mt-2 border-t border-line">
              {overview.hidden_posts.map((p) => (
                <li key={p.id} className="border-b border-line py-3 text-[15px]">
                  <p className="text-[13px] text-muted">
                    {p.author} · {when(p.hidden_at)} · {p.flags} {p.flags === 1 ? "report" : "reports"} · <Where p={p} postsOn={postsOn} />
                  </p>
                  {p.title && <p className="font-semibold text-navy">{p.title}</p>}
                  <p className="whitespace-pre-wrap break-words">{p.body}</p>
                  <ModerateForm op="unhide" id={p.id} label="Show again" />
                  <ModerateForm op="ban" id={p.author_id} scope={p.id} label={`Ban ${p.author}`} />
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
                  {r.banned ? <ModerateForm op="unban" id={r.user_id} label="Lift ban" /> : <ModerateForm op="ban" id={r.user_id} scope="restricted" label="Ban" />}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
