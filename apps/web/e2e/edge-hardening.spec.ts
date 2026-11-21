import { expect, test } from "@playwright/test";

// The site's edges: the files and error answers that scanners, browsers and link checkers ask for without being sent.

test("/.well-known/security.txt is plain text naming a contact, a canonical address and an expiry", async ({ request }) => {
  const res = await request.get("/.well-known/security.txt");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toMatch(/^text\/plain/);
  const body = await res.text();
  expect(body).toContain("Contact: mailto:contact@txsixmanfootball.com");
  expect(body).toMatch(/^Expires: \d{4}-\d{2}-\d{2}T/m);
  expect(body).toContain("Canonical: https://txsixmanfootball.com/.well-known/security.txt");
});

test("a game address with broken percent-encoding is a 400, not a 500, on both game routes", async ({ request }) => {
  for (const url of ["/api/games/%ff/comments", "/api/games/%E0%A4%A/comments", "/api/games/%ff/score-report"]) {
    const res = await request.get(url, { failOnStatusCode: false });
    expect(res.status(), url).toBe(400);
    expect(res.headers()["cache-control"], url).toMatch(/no-store/);
  }
  // A well-formed address still reaches the route (its list, or its own answer when posts are off): never 400.
  const ok = await request.get("/api/games/2026-09-04-guthrie-at-jayton/comments", { failOnStatusCode: false });
  expect(ok.status()).not.toBe(400);
});

test("/favicon.ico answers 200 with an icon file", async ({ request }) => {
  const res = await request.get("/favicon.ico");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toMatch(/image\/(x-icon|vnd\.microsoft\.icon)/);
  const bytes = await res.body();
  expect([...bytes.subarray(0, 4)]).toEqual([0, 0, 1, 0]); // an .ico header: type 1
  expect([...bytes.subarray(22, 26)]).toEqual([0x89, 0x50, 0x4e, 0x47]); // holding a PNG
});
