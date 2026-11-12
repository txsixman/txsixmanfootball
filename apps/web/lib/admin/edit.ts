import { type AuditEntry } from "./audit.ts";
import { Conflict, GithubError, type CorrectionFile } from "./github.ts";

// One edit, in the order that keeps every change audited: the audit row first, then the commit. If the commit then fails,
// a second audit row says the edit was NOT applied (an audit log is append-only, so it is corrected forward). Written with
// the two sides passed in, so the order and the failure paths are tested with fakes (scripts/admin.test.mjs).

export type EditDeps = {
  audit: (entry: AuditEntry) => Promise<void>;
  commit: (kind: CorrectionFile, edit: (text: string) => string, message: string) => Promise<{ commit: string }>;
};

export type EditResult = { ok: true; commit: string } | { ok: false; reason: "conflict" | "github" | "invalid" };

export async function runEdit(
  deps: EditDeps,
  { kind, entry, edit, message }: { kind: CorrectionFile; entry: AuditEntry; edit: (text: string) => string; message: string },
): Promise<EditResult> {
  await deps.audit(entry); // throws AuditFailed: nothing has changed yet
  try {
    return { ok: true, ...(await deps.commit(kind, edit, message)) };
  } catch (error) {
    // A thrown Conflict or GithubError is the commit; anything else is the new file failing its own checks.
    const reason = error instanceof Conflict ? "conflict" : error instanceof GithubError ? "github" : "invalid";
    try {
      await deps.audit({ ...entry, after: { applied: false, why: reason }, reason: `NOT APPLIED (${reason}): ${entry.reason}` });
    } catch {
      // The edit did not happen either way; the page says so. Nothing more to record.
    }
    return { ok: false, reason };
  }
}
