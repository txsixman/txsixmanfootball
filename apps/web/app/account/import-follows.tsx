"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { changeAccountFollows, fetchMe } from "@/lib/account/follows";
import { followedHere } from "@/lib/push";

const DISMISSED = "follow-import-dismissed";

/** Offers to copy this browser's followed programs into the account. Shown only while the browser follows programs the
 * account does not, and until the fan says "Not now" on this browser. The browser's own list is left as it is. */
export function ImportFollows() {
  const [missing, setMissing] = useState<string[]>([]);
  const [state, setState] = useState<"idle" | "busy" | "done" | "error" | "limit">("idle");

  useEffect(() => {
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(DISMISSED) === "1";
    } catch {
      // Private mode: ask again next time.
    }
    if (dismissed) return;
    let live = true;
    void fetchMe().then((answer) => {
      const me = answer?.me;
      if (!live || !me) return;
      setMissing(followedHere().filter((s) => !me.follows.includes(s)));
    });
    return () => {
      live = false;
    };
  }, []);

  if (!missing.length && state !== "done") return null;
  if (state === "done") return <p role="status" className="mt-4 text-[14px] text-ink">Done. Those teams are now on your account.</p>;

  async function add() {
    setState("busy");
    try {
      await changeAccountFollows({ op: "import", slugs: missing });
      setState("done");
    } catch (e) {
      setState((e as Error).message === "limit" ? "limit" : "error");
    }
  }
  function dismiss() {
    try {
      localStorage.setItem(DISMISSED, "1");
    } catch {
      // Nothing to remember it in.
    }
    setMissing([]);
  }

  return (
    <section aria-labelledby="import" className="mt-6 max-w-prose border border-line bg-panel p-3">
      <h2 id="import" className="font-num text-[20px] font-bold uppercase tracking-wide text-navy">Bring your teams along</h2>
      <p className="mt-1 text-[15px] text-ink">
        This browser follows {missing.length} {missing.length === 1 ? "team" : "teams"} that {missing.length === 1 ? "is" : "are"} not on your account yet. Add {missing.length === 1 ? "it" : "them"} so My teams is the same on every device?
      </p>
      <div className="mt-2 flex gap-2">
        <Button type="button" onClick={add} disabled={state === "busy"}>{state === "busy" ? "Adding…" : "Add them"}</Button>
        <Button type="button" variant="outline" onClick={dismiss} disabled={state === "busy"}>Not now</Button>
      </div>
      <div role="status">
        {state === "limit" && <p className="mt-2 text-[14px] font-semibold text-red">An account follows at most 100 teams.</p>}
        {state === "error" && <p className="mt-2 text-[14px] font-semibold text-red">That did not work. Try again in a minute.</p>}
      </div>
    </section>
  );
}
