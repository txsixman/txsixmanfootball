import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { authEnv, fanSignIn } from "../auth/config";
import { createAuthClient, getUser } from "../auth/server";
import { NEW_ACCOUNT_DAYS } from "../moderation/check";
import { checkSameOriginJson } from "../same-origin";

// What the posting route handlers share (fan comments, score reports, forums). Every Supabase call is made on the server:
// the session cookie is httpOnly and there is no browser client. A signed-in call is the fan's own session, the public
// anon key and a security-definer function that acts on auth.uid(); the database refuses a banned or muted account and
// repeats every text rule, so this layer only gives clear answers and cheap early refusals. No text, address, token or
// birth year is ever logged: only a short code.

/** What a refusal looks like to the page: a code to branch on and a sentence to show. */
const MESSAGES: Record<string, [number, string]> = {
  sign_in_required: [401, "Sign in to do that."],
  profile_required: [403, "Finish setting up your account first."],
  banned: [403, "This account cannot post."],
  muted: [403, "Your account is paused from posting for now."],
  rate_limited: [429, "You are doing that too fast. Try again in a few minutes."],
  blocked_text: [422, "That cannot be posted. Slurs and threats are not allowed."],
  links_not_allowed: [422, `Accounts under ${NEW_ACCOUNT_DAYS} days old cannot post links.`],
  too_many_links: [422, "Up to 2 links in a post."],
  bad_text: [422, "Write plain text, 1 to 2,000 characters."],
  unknown_game: [404, "This game is not open for that."],
  not_found: [404, "That is not here any more."],
  post_hidden: [409, "That post is hidden."],
  own_post: [400, "You cannot flag your own post."],
  game_closed: [409, "This game already has a score, so reports are closed."],
  too_early: [409, "Reports open two hours after kickoff, or at 6 PM Central on game day when no kickoff time is listed."],
  already_reported: [409, "You already reported this game."],
  bad_score: [422, "Enter a score for each team, 0 to 199, with no tie in a playoff game."],
  unknown_board: [404, "There is no such board."],
  admin_only: [403, "Not allowed."],
  cross_site: [403, "Not allowed."],
};

const NO_STORE = "no-store, private";

/** The answer for every fan route while FAN_SIGNIN is not "on": a plain 404, before anything reads a session or calls Supabase. Null when open. */
export function closed(): NextResponse | null {
  return fanSignIn() ? null : new NextResponse(null, { status: 404, headers: { "Cache-Control": NO_STORE } });
}

export function fail(code: string): NextResponse {
  const [status, message] = MESSAGES[code] ?? [500, "Something went wrong. Try again in a minute."];
  return NextResponse.json({ error: MESSAGES[code] ? code : "failed", message }, { status, headers: { "Cache-Control": NO_STORE } });
}

export const ok = (body: unknown = { ok: true }, status = 200): NextResponse =>
  NextResponse.json(body, { status, headers: { "Cache-Control": NO_STORE } });

/** The database's refusal as one of the codes above; anything else is logged by SQLSTATE only and shown as a plain failure. */
export function refusal(error: { message?: string; code?: string }): NextResponse {
  const code = error.message ?? "";
  if (code in MESSAGES) return fail(code);
  console.error("posts: database call failed", error.code ?? "unknown");
  return fail("failed");
}

/** The JSON body, or null when it is not JSON or is larger than 16 KB. A request that says it is larger is refused before its body is read. */
export async function readJson(request: NextRequest): Promise<unknown> {
  const declared = request.headers.get("content-length");
  if (declared !== null && !(Number(declared) <= 16_384)) return null;
  try {
    const text = await request.text();
    return text.length > 16_384 ? null : JSON.parse(text);
  } catch {
    return null;
  }
}

export type Fan = { supabase: SupabaseClient; displayName: string; established: boolean; muted: boolean; banned: boolean };

/** The signed-in fan with a profile, or the refusal to send. `write`: also checks the request came from this site. */
export async function fanFor(request: NextRequest, { write = true }: { write?: boolean } = {}): Promise<{ fan: Fan } | { response: NextResponse }> {
  if (write && checkSameOriginJson(request.headers) !== "ok") return { response: fail("cross_site") };
  const supabase = await createAuthClient();
  if (!supabase) return { response: fail("sign_in_required") };
  const found = await getUser(supabase);
  if (!found) return { response: fail("sign_in_required") };
  const { data, error } = await supabase.rpc("my_profile");
  if (error) return { response: refusal(error) };
  const row = (data as { display_name: string; created_at: string; muted_until: string | null; banned: boolean }[] | null)?.[0];
  if (!row) return { response: fail("profile_required") };
  const now = Date.now();
  return {
    fan: {
      supabase,
      displayName: row.display_name,
      established: Date.parse(row.created_at) <= now - NEW_ACCOUNT_DAYS * 864e5,
      muted: row.muted_until !== null && Date.parse(row.muted_until) > now,
      banned: row.banned,
    },
  };
}

/** A client with the public anon key and no session, for the public reads (cacheable, nothing user-specific). Null when not configured. */
export function publicClient(): SupabaseClient | null {
  const env = authEnv();
  return env ? createClient(env.url, env.anonKey, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
}
