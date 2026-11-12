import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

// A fan's own profile, read through my_profile() (migration 0011): the display name and the date joined. The birth year
// is never read back; no function returns it.

export type Profile = { displayName: string; createdAt: string; mutedUntil: string | null; banned: boolean };

const Row = z.object({ display_name: z.string(), created_at: z.string(), muted_until: z.string().nullable(), banned: z.boolean() });

/** The signed-in fan's profile, or null when they have not finished sign-up. Throws when the database cannot be asked,
 * so a hiccup is never mistaken for "no profile" (which sends a person to the sign-up form). */
export async function getProfile(supabase: SupabaseClient): Promise<Profile | null> {
  const { data, error } = await supabase.rpc("my_profile");
  if (error) throw new Error("my_profile failed");
  const rows = z.array(Row).parse(data);
  const row = rows[0];
  return row ? { displayName: row.display_name, createdAt: row.created_at, mutedUntil: row.muted_until, banned: row.banned } : null;
}

const Follows = z.array(z.object({ program_slug: z.string() }));

/** The signed-in fan's followed program slugs, oldest first. */
export async function getFollows(supabase: SupabaseClient): Promise<string[]> {
  const { data, error } = await supabase.rpc("my_follows");
  if (error) throw new Error("my_follows failed");
  return Follows.parse(data).map((r) => r.program_slug);
}
