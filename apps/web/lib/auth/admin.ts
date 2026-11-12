import type { SupabaseClient, User } from "@supabase/supabase-js";
import { adminUserId, authEnv } from "./config";
import { createAuthClient, getUser } from "./server";

// Who may use the admin console: exactly one Supabase user, named by ADMIN_USER_ID. Checked on the server by every admin
// page, server action and route handler. The database checks the same person again (is_admin() and admin_user,
// migration 0010), so neither check depends on who is allowed to sign up.

export type AdminState =
  | { kind: "unconfigured" }
  | { kind: "signed-out" }
  | { kind: "denied" }
  | { kind: "admin"; user: User; supabase: SupabaseClient };

export async function adminState(): Promise<AdminState> {
  const admin = adminUserId();
  if (!authEnv() || !admin) return { kind: "unconfigured" };
  const found = await getUser(await createAuthClient());
  if (!found) return { kind: "signed-out" };
  if (found.user.id.toLowerCase() !== admin) return { kind: "denied" };
  return { kind: "admin", ...found };
}

export class NotAdmin extends Error {
  constructor() {
    super("Not allowed");
    this.name = "NotAdmin";
  }
}

/** For a server action or route handler: the admin's user and client, or a thrown NotAdmin. No page-style fallbacks. */
export async function requireAdmin(): Promise<{ user: User; supabase: SupabaseClient }> {
  const state = await adminState();
  if (state.kind !== "admin") throw new NotAdmin();
  return state;
}
