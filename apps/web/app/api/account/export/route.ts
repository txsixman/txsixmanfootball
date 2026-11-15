import { NextResponse } from "next/server";
import { fanSignIn } from "@/lib/auth/config";
import { getUser } from "@/lib/auth/server";
import { exportMyData, isCenterError } from "@/lib/account/center";

// "Download my data" (ADR 0058): the signed-in fan's own data as one JSON file. The database's export_my_data (migration 0026)
// holds the profile, follows, devices, email settings and posts; this route adds the person's own email address and how they
// sign in, which live in Supabase Auth. Never in the file: the birth year (a sentence says it is stored), push endpoints and keys,
// email unsubscribe tokens. A GET that changes nothing, so no Origin lock; it needs the session, and the answer is never cached,
// indexed or sniffed. Nothing is logged.
export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "no-store, private", "X-Robots-Tag": "noindex, nofollow", "X-Content-Type-Options": "nosniff" };
const reply = (body: unknown, status: number) => NextResponse.json(body, { status, headers: HEADERS });

export async function GET() {
  if (!fanSignIn()) return reply({ error: "not found" }, 404); // fan accounts are off
  const found = await getUser();
  if (!found) return reply({ error: "sign in" }, 401);
  const data = await exportMyData(found.supabase, found.user);
  if (isCenterError(data)) return reply({ error: "unavailable" }, 503);
  return new NextResponse(`${JSON.stringify(data, null, 2)}\n`, {
    status: 200,
    headers: { ...HEADERS, "Content-Type": "application/json; charset=utf-8", "Content-Disposition": 'attachment; filename="txsixmanfootball-my-data.json"' },
  });
}
