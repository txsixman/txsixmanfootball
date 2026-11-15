"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { changeDisplayName, isCenterError, removeAllDevices, removeDevice } from "@/lib/account/center";
import { adminUserId, fanSignIn } from "@/lib/auth/config";
import { NAME_MESSAGE } from "@/lib/auth/sign-up";
import { getUser } from "@/lib/auth/server";
import { longDate } from "./dates";

// The Account Center's server actions (ADR 0058). Each acts as the signed-in fan, on their own rows, through lib/account/center.ts
// (the database checks everything again). Nothing here logs a name, an address, a device id or an error.

/** The signed-in fan, or a redirect: fan accounts must be on, and the admin has no part in fan flows. */
async function fan() {
  if (!fanSignIn()) redirect("/"); // fan accounts are off
  const found = await getUser();
  if (!found) redirect("/sign-in?next=%2Faccount");
  if (found.user.id.toLowerCase() === adminUserId()) redirect("/admin");
  return found;
}

export type RenameState = { saved?: boolean; error?: string; nextAt?: string };

const AGAIN = "That did not work. Try again in a minute.";

/** Change the display name: sign-up's rules, once every 30 days. The error comes back as a plain sentence, and `nextAt` when the clock is the reason. */
export async function renameDisplayName(_previous: RenameState, data: FormData): Promise<RenameState> {
  const found = await fan();
  const result = await changeDisplayName(found.supabase, typeof data.get("displayName") === "string" ? (data.get("displayName") as string) : "");
  if (!isCenterError(result)) {
    revalidatePath("/account");
    return { saved: true, nextAt: result.nextAt };
  }
  switch (result.error) {
    case "too_soon":
      return result.nextAt ? { error: `You can change it again on ${longDate(result.nextAt)}.`, nextAt: result.nextAt } : { error: "You changed your name recently. Try again in a few weeks." };
    case "taken":
      return { error: "That name is taken. Pick another." };
    case "bad_name":
      return { error: result.message ?? NAME_MESSAGE };
    default:
      return { error: AGAIN };
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Remove one linked browser: alerts to it stop. Only the caller's own device goes (the database matches the id to the account). */
export async function removeLinkedDevice(id: string): Promise<{ ok: boolean }> {
  const found = await fan();
  if (typeof id !== "string" || !UUID.test(id)) return { ok: false };
  const result = await removeDevice(found.supabase, id);
  if (isCenterError(result)) return { ok: false };
  revalidatePath("/account");
  return { ok: true };
}

export type SignOutAllState = { error?: string };

/**
 * Sign out of all devices: every linked browser is removed first (the sign-out rule of ADR 0054), then Supabase ends every session
 * of the account. If the browsers cannot be removed nothing is signed out and the person is told, so alerts never go on quietly
 * after a "sign out everywhere".
 */
export async function signOutEverywhere(_previous: SignOutAllState): Promise<SignOutAllState> {
  const found = await fan();
  const removed = await removeAllDevices(found.supabase);
  if (isCenterError(removed)) return { error: "Could not sign you out of every device right now. Try again in a minute." };
  await found.supabase.auth.signOut({ scope: "global" });
  redirect("/");
}
