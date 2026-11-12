"use server";

import { redirect } from "next/navigation";
import { adminUserId, fanSignIn } from "@/lib/auth/config";
import { getUser } from "@/lib/auth/server";

// Delete my account: delete_my_account() (migration 0011) removes the Auth user (email and sign-in) and, by cascade, the
// profile and the follows. Posts in later rounds hang off the profile the same way. Push alerts are per browser, not part
// of the account: this browser's are stopped with "Stop alerts" on a program page. Nothing here logs who deleted what.

export type DeleteState = { error?: string };

export async function deleteAccount(_previous: DeleteState, data: FormData): Promise<DeleteState> {
  if (!fanSignIn()) redirect("/"); // fan accounts are off: nothing to delete here
  if (data.get("confirm") !== "yes") return { error: "Confirm to delete your account." };
  const found = await getUser();
  if (!found) redirect("/sign-in");
  if (found.user.id.toLowerCase() === adminUserId()) redirect("/admin"); // never deletes the admin's account
  const { error } = await found.supabase.rpc("delete_my_account");
  if (error) return { error: "Could not delete your account right now. Try again in a minute." };
  // The user is gone, so there is no token to revoke: clear this browser's cookies only.
  await found.supabase.auth.signOut({ scope: "local" });
  redirect("/sign-in?deleted=1");
}
