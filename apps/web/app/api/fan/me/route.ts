import { NextResponse, type NextRequest } from "next/server";
import { closed, fanFor } from "@/lib/posts/api";

// Who is signed in, for the pages that show a posting form. Their own display name and whether they may post: nothing
// else (no id, email or birth year). Signed out is an ordinary answer, not an error. Never cached.
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const off = closed();
  if (off) return off;
  const found = await fanFor(request, { write: false });
  const headers = { "Cache-Control": "no-store, private" };
  if ("response" in found) {
    const error = ((await found.response.json()) as { error: string }).error;
    return NextResponse.json(error === "profile_required" ? { signedIn: true, profile: false } : { signedIn: false }, { headers });
  }
  const { displayName, established, muted, banned } = found.fan;
  return NextResponse.json({ signedIn: true, profile: true, displayName, established, canPost: !muted && !banned, muted, banned }, { headers });
}
