import { NextResponse } from "next/server";
import { pushAlertsOn } from "@/lib/push-flag";

// Whether the game-alerts toggle is shown (FAN_PUSH_ALERTS, lib/push-flag.ts). Public and the same for everyone: no session,
// no database, nothing logged; never cached, so flipping the flag takes effect on the next load.
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ alerts: pushAlertsOn() }, { headers: { "Cache-Control": "no-store" } });
}
