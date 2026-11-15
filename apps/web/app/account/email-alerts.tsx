import { getFollows } from "@/lib/auth/profile";
import { getUser } from "@/lib/auth/server";
import { emailAlertsOn } from "@/lib/email/config";
import { getEmailSettings } from "@/lib/email/settings";
import { EmailAlertsForm } from "./email-alerts-form";

/**
 * The account page's Email alerts block (ADR 0053), with the weekly digest's own checkbox (ADR 0055): off until EMAIL_ALERTS is "on" on the server, and never on for a fan
 * until they save it. It reads the fan's own settings and follows with their own session, as the page does. Reading fails
 * quietly into a short note: the rest of the account page still works.
 */
export async function EmailAlerts() {
  if (!emailAlertsOn()) return null;
  const found = await getUser();
  if (!found) return null;
  try {
    const [settings, digest, follows] = await Promise.all([getEmailSettings(found.supabase, "game_alerts"), getEmailSettings(found.supabase, "weekly_digest"), getFollows(found.supabase)]);
    return <EmailAlertsForm eligible={settings.eligible} follows={follows} allFollowed={settings.allFollowed} teams={settings.teams} digest={digest.allFollowed} />;
  } catch {
    return (
      <section aria-labelledby="email-alerts" className="mt-8 max-w-prose">
        <h2 id="email-alerts" className="font-num text-[20px] font-bold uppercase tracking-wide text-navy">Email alerts</h2>
        <p className="mt-1 text-[14px] text-muted">Email alerts are not available right now. Try again in a minute.</p>
      </section>
    );
  }
}
