// The hosted Supabase project's public address and publishable key, for code that runs in the browser. Both are public by
// design: browsers get them, and what they can do is set by the database (row-level security; the API roles run only the
// functions migration 0005 onward grants them: push_follow and push_unfollow for score alerts, live_scores for live scores).
// One place for push (lib/push.ts) and live scores (lib/live-scores.ts). No imports, so the node tests run it as it is.
export const SUPABASE_URL = "https://vhgnaihnyjdnaaergtcl.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_GIhfSzjOF1v-ldynK7inNQ_3NYbMVa0"; // gitleaks:allow (a publishable key: browsers get it by design; row-level security guards the data)
