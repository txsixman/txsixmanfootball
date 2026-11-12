"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { FormState } from "@/lib/admin/results";
import { moderatePost } from "./actions";

/** One override button with its required reason (the audit row keeps it). */
export function ModerateForm({ op, id, label }: { op: "unhide" | "unmute" | "ban" | "unban"; id: string; label: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(moderatePost, {});
  const field = `reason-${op}-${id}`;
  return (
    <form action={action} className="mt-2 flex flex-wrap items-end gap-2">
      <input type="hidden" name="op" value={op} />
      <input type="hidden" name="id" value={id} />
      <div className="flex min-w-48 flex-1 flex-col gap-1">
        <Label htmlFor={field}>Why</Label>
        <Input id={field} name="reason" required minLength={3} maxLength={200} />
      </div>
      <Button type="submit" variant={op === "ban" ? "default" : "outline"} disabled={pending}>
        {label}
      </Button>
      <div role="status" aria-live="polite" className="w-full">
        {state.ok && <p className="text-[15px] font-semibold text-navy">{state.ok}</p>}
        {state.error && <p className="text-[15px] font-semibold text-red">{state.fields?.reason ?? state.error}</p>}
      </div>
    </form>
  );
}
