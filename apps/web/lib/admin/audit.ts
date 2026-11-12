import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

// The audit trail: one audit_log row per edit, written by calling record_admin_audit() with the signed-in admin's OWN
// session (the public anon key plus their token, never a service key). Nobody has any right on the table itself: the
// function (migration 0010) refuses anyone who is not the admin and sets the actor from the session, so a row cannot name
// someone else. No read, no change. The row says what, to which game or name, before and after, and why.

export type AuditEntry = {
  entity: "game_correction" | "program_merge";
  /** A stable key for what was edited (the game's id, or the retired name); becomes `entity_id`, a uuid. */
  key: string;
  before: unknown;
  after: unknown;
  reason: string;
};

// A fixed namespace for uuid v5 (RFC 9562), so the same game or name always gets the same entity_id.
const NAMESPACE = "5f1c2b0e-8a7d-4e53-9b61-2c0d9f4a7e18";

/** Name-based uuid v5 of `${entity}:${key}`: audit rows about one thing can be found together. */
export function entityId(entity: string, key: string): string {
  const ns = Buffer.from(NAMESPACE.replace(/-/g, ""), "hex");
  const hash = createHash("sha1").update(ns).update(`${entity}:${key}`).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export class AuditFailed extends Error {
  constructor() {
    super("The audit row could not be written");
    this.name = "AuditFailed";
  }
}

/** Insert one audit row, or throw AuditFailed (the caller then changes nothing). No return value: the admin cannot read it back. */
export async function writeAudit(supabase: SupabaseClient, e: AuditEntry): Promise<void> {
  const { error } = await supabase.rpc("record_admin_audit", {
    p_entity: e.entity,
    p_entity_id: entityId(e.entity, e.key),
    p_before: { key: e.key, ...asObject(e.before) },
    p_after: { key: e.key, ...asObject(e.after) },
    p_reason: e.reason,
  });
  if (error) throw new AuditFailed(); // not logged: the error text can name the request
}

const asObject = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : { value: v });
