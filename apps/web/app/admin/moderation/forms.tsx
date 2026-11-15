"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { FormState } from "@/lib/admin/results";
import { moderatePost } from "./actions";

/** One override button with its required reason (the audit row keeps it); a mute also asks how many days. */
export function ModerateForm({ op, id, label, scope = "" }: { op: "hide" | "unhide" | "mute" | "unmute" | "ban" | "unban"; id: string; label: string; scope?: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(moderatePost, {});
  // scope: the post a form sits under, so one author's forms under two posts never share an id.
  const field = `reason-${op}-${id}${scope && `-${scope}`}`;
  return (
    <form action={action} className="mt-2 flex flex-wrap items-end gap-2">
      <input type="hidden" name="op" value={op} />
      <input type="hidden" name="id" value={id} />
      <div className="flex min-w-48 flex-1 flex-col gap-1">
        <Label htmlFor={field}>Why</Label>
        <Input id={field} name="reason" required minLength={3} maxLength={200} />
      </div>
      {op === "mute" && (
        <div className="flex flex-col gap-1">
          <Label htmlFor={`days-${field}`}>Days</Label>
          <select id={`days-${field}`} name="days" defaultValue="7" className="h-11 border border-line bg-page px-2 text-[16px] text-ink">
            {["1", "3", "7", "30", "90"].map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
      )}
      <Button type="submit" variant={op === "ban" || op === "hide" ? "default" : "outline"} disabled={pending}>
        {label}
      </Button>
      <div role="status" aria-live="polite" className="w-full">
        {state.ok && <p className="text-[15px] font-semibold text-navy">{state.ok}</p>}
        {state.error && <p className="text-[15px] font-semibold text-red">{state.fields?.reason ?? state.error}</p>}
      </div>
    </form>
  );
}
