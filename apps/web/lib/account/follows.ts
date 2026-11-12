// The browser side of account follows: who is signed in and what they follow, from /api/me (the auth cookies are
// httpOnly, so the page's script cannot read them; this one small request asks the server). One request per page load,
// shared by the header link, the Follow button and My teams. Offline or failing, the answer is "unknown" and the page
// carries on as a signed-out visitor would, with this browser's own follows.

/** `displayName` is null until sign-up is finished; `admin` marks the owner's account, which is never sent to fan sign-up. */
export type Me = { displayName: string | null; follows: string[]; admin?: boolean };
/** What /api/me says: whether fan accounts are on (FAN_SIGNIN), and who is signed in (null: nobody). */
export type MeAnswer = { enabled: boolean; me: Me | null };

/** Set when the last answer said signed in, so My teams can wait for the account's follows rather than flash the browser's. */
const HINT = "account-hint";

export const signedInHint = () => {
  try {
    return localStorage.getItem(HINT) === "1";
  } catch {
    return false;
  }
};

/** Forget that someone was signed in here: on sign-out and on deleting the account. */
export const clearSignedInHint = () => setHint(false);

const setHint = (on: boolean) => {
  try {
    if (on) localStorage.setItem(HINT, "1");
    else localStorage.removeItem(HINT);
  } catch {
    // Private mode: nothing to remember.
  }
};

let pending: Promise<MeAnswer | undefined> | undefined;

/** undefined: could not be asked (offline or failing). */
export function fetchMe(force = false): Promise<MeAnswer | undefined> {
  if (force || !pending) {
    pending = fetch("/api/me", { cache: "no-store", credentials: "same-origin", signal: AbortSignal.timeout(8_000) })
      .then(async (res) => {
        if (!res.ok) return undefined;
        const body = (await res.json()) as MeAnswer;
        setHint(body.me !== null);
        return body;
      })
      .catch(() => undefined);
  }
  return pending;
}

export type FollowOp = { op: "follow" | "unfollow"; slug: string } | { op: "import"; slugs: string[] };

/** Change the account's follows; returns the account's follows afterwards. Throws with "limit" when the account is full. */
export async function changeAccountFollows(body: FollowOp): Promise<string[]> {
  const res = await fetch("/api/follows", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(body),
  });
  if (res.status === 409) throw new Error("limit");
  if (!res.ok) throw new Error(`follows: ${res.status}`);
  const follows = ((await res.json()) as { follows: string[] }).follows;
  void fetchMe(true);
  return follows;
}
