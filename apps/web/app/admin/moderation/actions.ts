"use server";

import { revalidatePath } from "next/cache";
import { NotAdmin, requireAdmin } from "@/lib/auth/admin";
import { fieldErrors, formFields, ModerateInput } from "@/lib/admin/inputs";
import { moderate } from "@/lib/admin/moderation";
import type { FormState } from "@/lib/admin/results";

// A server action is a public POST endpoint: check the admin here, validate every field, then let the database function
// check is_admin() again and write the audit row.

const DONE = { unhide: "Shown again.", unmute: "Mute lifted.", ban: "Banned.", unban: "Ban lifted." } as const;

export async function moderatePost(_previous: FormState, data: FormData): Promise<FormState> {
  let supabase;
  try {
    ({ supabase } = await requireAdmin());
  } catch (e) {
    return { error: e instanceof NotAdmin ? "Not allowed." : "Admin is not configured." };
  }
  const parsed = ModerateInput.safeParse(formFields(data, ["op", "id", "reason"]));
  if (!parsed.success) return { error: "Check the highlighted fields.", fields: fieldErrors(parsed.error) };
  const result = await moderate(supabase, parsed.data);
  revalidatePath("/admin/moderation");
  if (result === "done") return { ok: DONE[parsed.data.op] };
  if (result === "already") return { error: "Nothing to change: it was already done." };
  if (result === "denied") return { error: "Not allowed. Sign in again, and check that your id is in admin_user." };
  return { error: "The database refused the change. Nothing was changed." };
}
