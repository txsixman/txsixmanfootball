import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

// A fan's own email settings, read through email_my_settings() (migration 0022): whether the account may opt in, and what it has
// opted in to. The birth year and the address are never read back: the function returns neither.

type EmailSettings = { eligible: boolean; allFollowed: boolean; teams: string[] };

const Rows = z.array(z.object({ eligible: z.boolean(), kind: z.string().nullable(), program_slug: z.string().nullable() }));

/** The signed-in fan's settings for one kind of email. Throws when the database cannot be asked, so a hiccup is never shown as "off". */
export async function getEmailSettings(supabase: SupabaseClient, kind: "game_alerts" | "weekly_digest"): Promise<EmailSettings> {
  const { data, error } = await supabase.rpc("email_my_settings");
  if (error) throw new Error("email_my_settings failed");
  const rows = Rows.parse(data);
  const mine = rows.filter((r) => r.kind === kind && r.program_slug);
  return {
    eligible: rows[0]?.eligible ?? false,
    allFollowed: mine.some((r) => r.program_slug === "*"),
    teams: mine.flatMap((r) => (r.program_slug && r.program_slug !== "*" ? [r.program_slug] : [])),
  };
}
