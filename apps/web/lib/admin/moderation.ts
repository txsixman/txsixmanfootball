import type { SupabaseClient } from "@supabase/supabase-js";
import type { ModerateInput } from "./inputs.ts";

// The owner's moderation overrides (ADRs 0018, 0061): hide a post or show it again, mute an account or lift a mute, ban or
// unban. Each is one call to a migration-0013 or 0027 function with the admin's OWN session; the function checks is_admin() itself and writes the
// audit_log row (ids and states, never the text). No service key, no table access from here.

type HiddenPost = {
  id: string;
  author_id: string;
  author: string;
  game_key: string | null;
  thread_id: string | null;
  title: string | null;
  body: string;
  hidden_at: string;
  flags: number;
};
type FlaggedPost = Omit<HiddenPost, "hidden_at"> & { created_at: string; counted: number; last_flag_at: string };
type Restricted = { user_id: string; display_name: string; muted_until: string | null; banned: boolean };
export type Overview = { flagged_posts: FlaggedPost[]; hidden_posts: HiddenPost[]; restricted: Restricted[] };

/** Flagged posts not hidden yet (most flags first), hidden posts (newest first), both with their text, and muted or banned accounts; null when refused. */
export async function moderationOverview(supabase: SupabaseClient): Promise<Overview | null> {
  const { data, error } = await supabase.rpc("admin_moderation_overview");
  if (error || !data || typeof data !== "object") return null;
  const o = data as Partial<Overview>;
  const list = <T,>(v: T[] | undefined): T[] => (Array.isArray(v) ? v : []);
  return { flagged_posts: list(o.flagged_posts), hidden_posts: list(o.hidden_posts), restricted: list(o.restricted) };
}

export type RecentPost = Omit<HiddenPost, "hidden_at"> & { created_at: string };

/**
 * The newest posts still showing, last 7 days, at most 100 (admin_recent_posts, migration 0032, ADR 0084), so the owner can hide
 * one nobody reported. "missing" before the migration is on the database (the page then says so); null when refused.
 */
export async function recentPosts(supabase: SupabaseClient): Promise<RecentPost[] | "missing" | null> {
  const { data, error } = await supabase.rpc("admin_recent_posts");
  if (error) return error.code === "PGRST202" || error.code === "42883" ? "missing" : null;
  return Array.isArray(data) ? (data as RecentPost[]) : null;
}

export type ModerateResult = "done" | "already" | "denied" | "failed";

/** Run one override. "already": nothing to change (the post already hidden or shown, the account not muted or muted longer, the ban already set). */
export async function moderate(supabase: SupabaseClient, m: ModerateInput): Promise<ModerateResult> {
  const { error } =
    m.op === "mute"
      ? await supabase.rpc("admin_mute", { p_user: m.id, p_days: m.days, p_reason: m.reason })
      : m.op === "hide"
        ? await supabase.rpc("admin_hide_post", { p_post: m.id, p_reason: m.reason })
        : m.op === "unhide"
          ? await supabase.rpc("admin_unhide_post", { p_post: m.id, p_reason: m.reason })
          : m.op === "unmute"
            ? await supabase.rpc("admin_unmute", { p_user: m.id, p_reason: m.reason })
            : await supabase.rpc("admin_set_ban", { p_user: m.id, p_banned: m.op === "ban", p_reason: m.reason });
  if (!error) return "done";
  if (error.code === "42501") return "denied";
  if (error.message === "not_found") return "already";
  return "failed";
}

type ReportedScore = { home_score: number; away_score: number; reports: number; counted: number; disagrees: boolean };
type FanReportedGame = {
  game_key: string;
  game_date: string | null;
  home: string;
  away: string;
  status: string;
  home_score: number | null;
  away_score: number | null;
  last_report_at: string;
  scores: ReportedScore[];
};

/**
 * Games fans reported a score for in the last 60 days, newest report first (admin_fan_score_reports, migration 0027, ADR 0062),
 * never who reported. Read-only: a report never changes a game; a correction is still made with the correction form. Null when refused.
 */
export async function fanScoreReports(supabase: SupabaseClient): Promise<FanReportedGame[] | null> {
  const { data, error } = await supabase.rpc("admin_fan_score_reports");
  if (error) return null;
  return Array.isArray(data) ? (data as FanReportedGame[]).map((g) => ({ ...g, scores: Array.isArray(g.scores) ? g.scores : [] })) : [];
}
