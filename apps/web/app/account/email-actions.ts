"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { adminUserId, fanSignIn } from "@/lib/auth/config";
import { getUser } from "@/lib/auth/server";
import { emailAlertsOn } from "@/lib/email/config";

// Save the signed-in fan's email alert choices: every team they follow ("all"), or the teams ticked. email_set_optins
// (migration 0022) is the real check: own rows only, an adult account, a team the account follows, at most 101 entries. A
// choice of nothing turns the alerts off. Never on by default: nothing is saved until this runs. Nothing here logs an address,
// a team or the database's error text.

export type EmailAlertsState = { saved?: boolean; error?: string };

// The weekly digest (ADR 0055) is the same save with the other kind: "digest" ticked turns on the digest for every team the fan
// follows ("*", so a team followed later is covered), unticked turns it off. Same checks, same database function.

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** The signed-in fan, or a redirect: fan accounts and email must be on, and the admin has no part in fan flows. */
async function fanForEmail() {
  if (!fanSignIn() || !emailAlertsOn()) redirect("/"); // fan accounts or email alerts are off: nothing to save here
  const found = await getUser();
  if (!found) redirect("/sign-in?next=%2Faccount");
  if (found.user.id.toLowerCase() === adminUserId()) redirect("/admin");
  return found;
}

async function save(kind: "game_alerts" | "weekly_digest", slugs: string[]): Promise<EmailAlertsState> {
  const found = await fanForEmail();
  const { error } = await found.supabase.rpc("email_set_optins", { p_kind: kind, p_slugs: slugs });
  if (error) {
    // 42501: not available to this account. 22023: a team the account does not follow.
    if (error.code === "42501") return { error: "Email alerts are not available for this account." };
    if (error.code === "22023") return { error: "Follow a team before turning on its emails." };
    return { error: "That did not save. Try again in a minute." };
  }
  revalidatePath("/account");
  return { saved: true };
}

export async function saveEmailAlerts(_previous: EmailAlertsState, data: FormData): Promise<EmailAlertsState> {
  const teams = data.getAll("team").filter((t): t is string => typeof t === "string" && t.length <= 80 && SLUG.test(t));
  return save("game_alerts", data.get("all") === "on" ? ["*"] : [...new Set(teams)]);
}

export async function saveEmailDigest(_previous: EmailAlertsState, data: FormData): Promise<EmailAlertsState> {
  return save("weekly_digest", data.get("digest") === "on" ? ["*"] : []);
}
