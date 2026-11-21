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
