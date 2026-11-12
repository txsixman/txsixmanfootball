import type { SupabaseClient } from "@supabase/supabase-js";
import type { ModerateInput } from "./inputs.ts";

// The owner's moderation overrides (ADR 0018): show a hidden post again, lift a mute, ban or unban an account. Each is one
// call to a migration-0013 function with the admin's OWN session; the function checks is_admin() itself and writes the
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
type Restricted = { user_id: string; display_name: string; muted_until: string | null; banned: boolean };
export type Overview = { hidden_posts: HiddenPost[]; restricted: Restricted[] };

/** Hidden posts (newest first, with their text) and muted or banned accounts, or null when the call is refused. */
export async function moderationOverview(supabase: SupabaseClient): Promise<Overview | null> {
  const { data, error } = await supabase.rpc("admin_moderation_overview");
  if (error || !data || typeof data !== "object") return null;
  const o = data as Partial<Overview>;
  return { hidden_posts: Array.isArray(o.hidden_posts) ? o.hidden_posts : [], restricted: Array.isArray(o.restricted) ? o.restricted : [] };
}

export type ModerateResult = "done" | "already" | "denied" | "failed";

/** Run one override. "already": nothing to change (the post is not hidden, the account not muted, the ban already set). */
export async function moderate(supabase: SupabaseClient, m: ModerateInput): Promise<ModerateResult> {
  const { error } =
    m.op === "unhide"
      ? await supabase.rpc("admin_unhide_post", { p_post: m.id, p_reason: m.reason })
      : m.op === "unmute"
        ? await supabase.rpc("admin_unmute", { p_user: m.id, p_reason: m.reason })
        : await supabase.rpc("admin_set_ban", { p_user: m.id, p_banned: m.op === "ban", p_reason: m.reason });
  if (!error) return "done";
  if (error.code === "42501") return "denied";
  if (error.message === "not_found") return "already";
  return "failed";
}
