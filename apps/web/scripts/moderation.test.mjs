// The site's copy of the word list and link rules (lib/moderation): the same vectors the database is tested with
// (packages/db/test/moderation.test.mjs), and the display-name rule.   node --test apps/web/scripts/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import fold from "../lib/moderation/fold.json" with { type: "json" };
import { checkText, isBlocked, linkCount, normalize, splitLinks } from "../lib/moderation/check.ts";
import { displayNameProblem } from "../lib/moderation/names.ts";

const vectors = JSON.parse(readFileSync(new URL("../lib/moderation/vectors.json", import.meta.url), "utf8"));

test("every shared vector is blocked or let through as the database does", () => {
  for (const v of vectors.blocked) assert.equal(isBlocked(v.text), v.blocked, JSON.stringify(v.text));
  for (const v of vectors.links) assert.equal(linkCount(v.text), v.links, JSON.stringify(v.text));
});

test("every invisible or combining character is dropped from inside a word", () => {
  for (const [lo, hi] of vectors.invisible) {
    for (let c = lo; c <= hi; c++) assert.equal(normalize(`k${String.fromCodePoint(c)}ike`), "kike", c.toString(16));
  }
});

test("every look-alike pair in fold.json folds to its letter", () => {
  for (const [i, c] of [...fold.from].entries()) assert.equal(normalize(c), fold.to[i], c);
});

test("text is folded to plain words", () => {
  assert.equal(normalize("N1GG3R"), "nigger");
  assert.equal(normalize("Ça va, l'été!!!"), "ca va lete");
  assert.equal(normalize("aaaa b.c"), "aa b c");
  assert.equal(normalize("  "), "");
  assert.equal(normalize("kill you!"), "kill you");
});

test("checkText gives the first reason a post is refused", () => {
  assert.equal(checkText("Good game", { established: false }), null);
  assert.equal(checkText("  ", { established: true }), "bad_text");
  assert.equal(checkText("x".repeat(2001), { established: true }), "bad_text");
  assert.equal(checkText("I will kill you", { established: true }), "blocked_text");
  assert.equal(checkText("see example.com", { established: false }), "links_not_allowed");
  assert.equal(checkText("see example.com", { established: true }), null);
  assert.equal(checkText("a.com b.com c.com", { established: true }), "too_many_links");
});

test("every address the page makes clickable is counted", () => {
  // The oracle is the page's original pattern: an http(s) address up to a space, quote or angle bracket, in text where odd spaces are plain ones.
  const clickable = (t) => (t.replace(/[\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]/g, " ").match(/https?:\/\/[^\s<>"']+/gi) ?? []).length;
  for (const v of vectors.links) {
    assert.ok(clickable(v.text) <= v.links, JSON.stringify(v.text));
    assert.ok(splitLinks(v.text).filter((p) => p.href).length <= linkCount(v.text), JSON.stringify(v.text));
  }
  assert.deepEqual(
    splitLinks("go (https://a.com/x), then https://b.tk."),
    [{ text: "go (" }, { text: "https://a.com/x", href: "https://a.com/x" }, { text: "), then " }, { text: "https://b.tk", href: "https://b.tk/" }, { text: "." }],
  );
});

test("accounts under 7 days get no address of any kind, however it is spaced or hidden; older ones up to two", () => {
  for (const t of ["see https://example.com", "ftp://x", "www.example.org", "ht\u200btps://a", "w\u200bww.x", "\uff57\uff57\uff57\uff0ex", "x:https://a.ai", "a\u00a0b.com"]) {
    assert.equal(checkText(t, { established: false }), "links_not_allowed", JSON.stringify(t));
  }
  assert.equal(checkText("(https://a.ai/x) and https://b.tk", { established: true }), null);
  assert.equal(checkText("https://a.com\u00a0https://b.com\u3000https://c.com", { established: true }), "too_many_links");
  assert.equal(checkText("https://a.com'https://b.com'https://c.com", { established: true }), "too_many_links");
});

test("text with nothing to read, or a direction-changing character, is bad text", () => {
  for (const t of ["\u200b\u200b", "!!! ??? ...", "\ud83d\udd25\ud83d\udd25", "\u0301", "good \u202egame", "a\u2066b", "good \u2069game"]) {
    assert.equal(checkText(t, { established: true }), "bad_text", JSON.stringify(t));
  }
  assert.equal(checkText("50-0!", { established: true }), null);
});

test("display names are held to the same word list, and the names that pretend to be the site are reserved", () => {
  for (const v of vectors.names) {
    const got = displayNameProblem(v.name);
    if (v.problem === null) assert.equal(got, null, v.name);
    else assert.match(got ?? "", v.problem === "blocked" ? /not allowed/ : /reserved/, v.name);
  }
});
