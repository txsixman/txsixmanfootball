import type { SupabaseClient } from "@supabase/supabase-js";
import { emailAlertsOn } from "@/lib/email/config";
import { getEmailSettings } from "@/lib/email/settings";

/**
 * What the account page knows about the fan's email alerts (ADR 0053, 0055, 0058), read once with their own session and handed to
 * both places that show it: the per-team "Email alerts" toggles under My teams and the Email alerts block under Alerts and devices.
 * "off": EMAIL_ALERTS is not on, so nothing is offered. "error": the database could not be asked (a note, never "off"). "ready":
 * `eligible` is false for an account that may not opt in; `all` is the "all the teams I follow" choice; `teams` the ones picked one by
 * one; `digest` the weekly digest.
 */
export type EmailState = { status: "off" } | { status: "error" } | { status: "ready"; eligible: boolean; all: boolean; teams: string[]; digest: boolean };

export async function loadEmailState(supabase: SupabaseClient): Promise<EmailState> {
  if (!emailAlertsOn()) return { status: "off" };
  try {
    const [alerts, digest] = await Promise.all([getEmailSettings(supabase, "game_alerts"), getEmailSettings(supabase, "weekly_digest")]);
    return { status: "ready", eligible: alerts.eligible, all: alerts.allFollowed, teams: alerts.teams, digest: digest.allFollowed };
  } catch {
    return { status: "error" };
  }
}
