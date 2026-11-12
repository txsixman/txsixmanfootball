"use server";

import { redirect } from "next/navigation";
import { adminUserId, fanSignIn, safeNext } from "@/lib/auth/config";
import { getProfile } from "@/lib/auth/profile";
import { getUser } from "@/lib/auth/server";
import { decideSignUp } from "@/lib/auth/age";
import { NAME_MESSAGE, SignUpFields } from "@/lib/auth/sign-up";
import { displayNameProblem } from "@/lib/moderation/names";

// Sign-up's last step. The birth year decides what happens: 14 or older goes on, exactly 13 years back is asked "Have you
// had your 13th birthday?" (the answer is used once and never stored), and under 13 deletes the account at once and keeps
// nothing. The database checks the age again (create_profile, migration 0011). Nothing here logs a name, a year or an error.

export type WelcomeState = { error?: string; ask13?: boolean };

/** An under-13 sign-up: erase the Auth user (and so any profile) and end the session. Nothing about the person is kept.
 * If the erase fails nothing is claimed: the person is told to try again, and no profile (no birth year) exists either way. */
async function refuseUnder13(supabase: NonNullable<Awaited<ReturnType<typeof getUser>>>["supabase"]): Promise<WelcomeState> {
  const { error } = await supabase.rpc("delete_my_account");
  if (error) return { error: "We could not finish that. Try again in a minute." };
  // The user is gone, so there is no token for the server to revoke: clear this browser's cookies only.
  await supabase.auth.signOut({ scope: "local" });
  redirect("/account/too-young");
}

export async function finishSignUp(_previous: WelcomeState, data: FormData): Promise<WelcomeState> {
  if (!fanSignIn()) redirect("/");
  const found = await getUser();
  if (!found) redirect("/sign-in?next=/account/welcome");
  if (found.user.id.toLowerCase() === adminUserId()) redirect("/admin"); // the admin has no part in fan flows
  const { supabase } = found;
  const next = safeNext(data.get("next"));

  const text = (k: string) => (typeof data.get(k) === "string" ? (data.get(k) as string) : "");
  const fields = SignUpFields.safeParse({ displayName: text("displayName"), birthYear: text("birthYear"), turned13: text("turned13") });
  if (!fields.success) return { error: fields.error.issues[0]?.message ?? NAME_MESSAGE };
  const { displayName, birthYear, turned13 } = fields.data;

  const decision = decideSignUp(birthYear, turned13);
  if (decision === "bad-year") return { error: "Enter the year you were born, four digits." };
  if (decision === "ask-13") return { ask13: true };
  if (decision === "under-13") return refuseUnder13(supabase);

  const problem = displayNameProblem(displayName);
  if (problem) return { error: problem };

  const { error } = await supabase.rpc("create_profile", { p_display_name: displayName, p_birth_year: birthYear, p_turned_13: turned13 === "yes" });
  if (error) {
    if (error.code === "22023") return refuseUnder13(supabase); // the database's own age check
    if (error.code === "23505") {
      // Unique name, or already has a profile (a second tab): only the second is not a name problem.
      if (await getProfile(supabase).catch(() => null)) redirect(next);
      return { error: "That name is taken. Pick another." };
    }
    if (error.code === "23514") {
      // A malformed name, or one the word list or the reserved list refuses (create_profile, migration 0013).
      if (error.message.includes("name_reserved")) return { error: "Pick a different name. That one is reserved." };
      if (error.message.includes("name_not_allowed")) return { error: "Pick a different name. That one is not allowed." };
      return { error: NAME_MESSAGE };
    }
    return { error: "That did not work. Try again in a minute." };
  }
  redirect(`/account?welcome=1&next=${encodeURIComponent(next)}`);
}
