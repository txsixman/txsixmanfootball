// A web address whose percent-encoding is broken (a lone "%ff", "%E0%A4%A", a trailing "%") cannot be decoded, and Next
// throws while matching a dynamic route's parameter, which surfaced as a 500 on /api/games/%ff/comments. The proxy asks
// this first and answers 400, the right answer for a malformed request. Pure and import-free so scripts can test it.
export function hasBadEncoding(pathname: string): boolean {
  try {
    decodeURIComponent(pathname);
    return false;
  } catch {
    return true;
  }
}
