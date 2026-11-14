import { siteOrigin } from "./auth/config.ts";

/**
 * The lock on every write a browser makes to this site's own API: the request must carry an Origin that is this site's
 * own (a browser sends one on every cross-site POST, and a missing one is refused, never waved through), and the body
 * must be JSON, which a cross-site form cannot send. Session cookies are SameSite=Lax as well; this is the second lock.
 * "origin" and "type" let a route keep its own status codes (403 and 415).
 */
export function checkSameOriginJson(headers: Headers): "ok" | "origin" | "type" {
  if (headers.get("origin") !== siteOrigin(headers.get("host"))) return "origin";
  return (headers.get("content-type") ?? "").toLowerCase().startsWith("application/json") ? "ok" : "type";
}
