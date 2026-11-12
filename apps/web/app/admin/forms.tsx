"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { FormState } from "@/lib/admin/results";
import { fixGame, mergePrograms } from "./actions";

function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-[13px] text-muted">{hint}</p>}
      {error && <p id={`${id}-error`} className="text-[13px] font-semibold text-red">{error}</p>}
    </div>
  );
}

function Result({ state }: { state: FormState }) {
  return (
    <div role="status" aria-live="polite">
      {state.ok && <p className="text-[15px] font-semibold text-navy">{state.ok}</p>}
      {state.error && <p className="text-[15px] font-semibold text-red">{state.error}</p>}
    </div>
  );
}

const reasonFields = (errors: Record<string, string> = {}) => (
  <>
    <Field id="source_url" label="Page that shows the right fact" hint="A public https:// page: the school's own site, a league page." error={errors.source_url}>
      <Input id="source_url" name="source_url" type="url" inputMode="url" required maxLength={600} placeholder="https://" aria-describedby="source_url-error" />
    </Field>
    <Field id="reason" label="Why" hint="A few words. Commas become semicolons." error={errors.reason}>
      <Input id="reason" name="reason" required minLength={3} maxLength={200} aria-describedby="reason-error" />
    </Field>
  </>
);

export function GameFixForm({ id, home, away, homeScore, awayScore }: { id: string; home: string; away: string; homeScore: number; awayScore: number }) {
  const [state, action, pending] = useActionState<FormState, FormData>(fixGame, {});
  const [kind, setKind] = useState<"score" | "forfeit" | "void">("score");
  const errors = state.fields ?? {};
  return (
    <form action={action} className="mt-4 flex max-w-md flex-col gap-4">
      <input type="hidden" name="id" value={id} />
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-[13px] font-semibold text-ink">What is wrong</legend>
        {(
          [
            ["score", "The score"],
            ["forfeit", "It was a forfeit"],
            ["void", "It was not a game (listed in error)"],
          ] as const
        ).map(([value, label]) => (
          <label key={value} className="flex min-h-11 items-center gap-3 text-[15px]">
            <input type="radio" name="action" value={value} checked={kind === value} onChange={() => setKind(value)} className="size-5 accent-[var(--color-navy)]" />
            {label}
          </label>
        ))}
      </fieldset>
      {kind === "score" && (
        <div className="grid grid-cols-2 gap-3">
          <Field id="home_score" label={`${home} (home)`} error={errors.home_score}>
            <Input id="home_score" name="home_score" inputMode="numeric" pattern="[0-9]{1,3}" required defaultValue={homeScore} aria-describedby="home_score-error" />
          </Field>
          <Field id="away_score" label={away} error={errors.away_score}>
            <Input id="away_score" name="away_score" inputMode="numeric" pattern="[0-9]{1,3}" required defaultValue={awayScore} aria-describedby="away_score-error" />
          </Field>
        </div>
      )}
      {kind === "forfeit" && (
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-[13px] font-semibold text-ink">Who won it</legend>
          {(
            [
              ["home", home],
              ["away", away],
            ] as const
          ).map(([value, team]) => (
            <label key={value} className="flex min-h-11 items-center gap-3 text-[15px]">
              <input type="radio" name="winner" value={value} required className="size-5 accent-[var(--color-navy)]" />
              {team}
            </label>
          ))}
          {errors.winner && <p className="text-[13px] font-semibold text-red">{errors.winner}</p>}
        </fieldset>
      )}
      {reasonFields(errors)}
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : kind === "void" ? "Void this game" : "Save correction"}</Button>
      <Result state={state} />
    </form>
  );
}

export function MergeForm({ unlisted, schools }: { unlisted: string[]; schools: string[] }) {
  const [state, action, pending] = useActionState<FormState, FormData>(mergePrograms, {});
  const errors = state.fields ?? {};
  return (
    <form action={action} className="mt-4 flex max-w-md flex-col gap-4">
      <Field id="name" label="This spelling" hint="A name the results use that no league lists, exactly as written." error={errors.name}>
        <Input id="name" name="name" list="unlisted-names" required maxLength={120} autoComplete="off" aria-describedby="name-error" />
      </Field>
      <Field id="same_as" label="Is the same program as" hint="A listed program." error={errors.same_as}>
        <Input id="same_as" name="same_as" list="listed-programs" required maxLength={120} autoComplete="off" aria-describedby="same_as-error" />
      </Field>
      <datalist id="unlisted-names">{unlisted.map((n) => <option key={n} value={n} />)}</datalist>
      <datalist id="listed-programs">{schools.map((n) => <option key={n} value={n} />)}</datalist>
      {reasonFields(errors)}
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Merge"}</Button>
      <Result state={state} />
    </form>
  );
}
