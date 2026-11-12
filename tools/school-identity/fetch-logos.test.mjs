import assert from "node:assert/strict";
import { test } from "node:test";
import { parseRobots, robotsAllowed, sniff, sourceProblem } from "./fetch-logos.mjs";

const school = (image, page = "https://www.alphaisd.net/athletics") => ({ site: "https://www.alphaisd.net", logo: { image, page } });

test("a logo must come from the school's own site or its website platform", () => {
  assert.equal(sourceProblem(school("https://www.alphaisd.net/logo.png")), null);
  assert.equal(sourceProblem(school("https://cdn.alphaisd.net/img/logo.png")), null);
  assert.equal(sourceProblem(school("https://resources.finalsite.net/images/v1/alpha/logo.png")), null);
  assert.match(sourceProblem(school("https://images.maxpreps.com/x.png")), /banned/);
  assert.match(sourceProblem(school("https://upload.wikimedia.org/x.png")), /banned/);
  assert.match(sourceProblem(school("https://randomfans.com/x.png")), /not the school site/);
  assert.match(sourceProblem(school("https://www.alphaisd.net/l.png", "https://www.sixmanfootball.com/alpha")), /banned/);
  assert.match(sourceProblem(school("https://www.alphaisd.net/l.png", "https://otherisd.net/a")), /not on the school site/);
  assert.equal(sourceProblem({ site: "https://www.alpha.k12.tx.us", logo: { image: "https://www.alpha.k12.tx.us/l.png", page: "https://alpha.k12.tx.us/" } }), null);
});

test("file type comes from the bytes, and unsafe SVGs are refused", () => {
  assert.deepEqual(sniff(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0])), { ext: "png" });
  assert.deepEqual(sniff(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), { ext: "jpg" });
  assert.deepEqual(sniff(Buffer.from('<svg viewBox="0 0 1 1"><path d="M0 0" fill="#800"/><use href="#a"/></svg>')), { ext: "svg" });
  assert.match(sniff(Buffer.from("<svg><script>alert(1)</script></svg>")).error, /script/);
  assert.match(sniff(Buffer.from('<svg onload="x()"></svg>')).error, /script/);
  assert.match(sniff(Buffer.from('<svg><image href="https://evil.test/x.png"/></svg>')).error, /script/);
  assert.match(sniff(Buffer.from("<html>not an image</html>")).error, /not a PNG/);
});

test("Dave Campbell's team pages and image host are an allowed source (ADR 0016), and nothing else is let in by them", () => {
  const dctf = (image, page = "https://www.davecampbells.com/team/alpha-lions") => ({ site: "https://www.alphaisd.net", logo: { image, page } });
  assert.equal(sourceProblem(dctf("https://images.davecampbells.com/HighSchool/logo/alpha-lions.png")), null);
  assert.equal(sourceProblem(dctf("https://images.davecampbells.com/x.png", "https://www.texasfootball.com/team/alpha")), null);
  assert.match(sourceProblem(dctf("https://randomfans.com/alpha.png")), /not Dave Campbell's image host/);
  assert.match(sourceProblem(dctf("https://images.maxpreps.com/alpha.png")), /banned/);
  assert.match(sourceProblem({ site: null, logo: { image: "https://www.alphaisd.net/l.png", page: "https://www.alphaisd.net/" } }), /no school site/);
});

test("robots.txt: the * group decides, the longest matching rule wins, no file means allowed", () => {
  const rules = parseRobots("User-agent: Googlebot-Image\nAllow: /\n\nUser-agent: *\nDisallow: /api\nDisallow: /files/\nAllow: /files/logos/\n# comment\n");
  assert.equal(robotsAllowed(rules, "/team/alpha"), true);
  assert.equal(robotsAllowed(rules, "/api/x"), false);
  assert.equal(robotsAllowed(rules, "/files/a.png"), false);
  assert.equal(robotsAllowed(rules, "/files/logos/a.png"), true);
  assert.equal(robotsAllowed(parseRobots(""), "/anything"), true);
  assert.equal(robotsAllowed(parseRobots("User-agent: *\nDisallow: /"), "/logo.png"), false);
  assert.equal(robotsAllowed(parseRobots("User-agent: Googlebot-Image\nAllow: /\n\nUser-agent: *\nDisallow: /"), "/logo.png"), false);
  assert.equal(robotsAllowed(parseRobots("User-agent: *\nDisallow: /*.pdf$"), "/a/b.pdf"), false);
  assert.equal(robotsAllowed(parseRobots("User-agent: *\nDisallow: /*.pdf$"), "/a/b.png"), true);
});
