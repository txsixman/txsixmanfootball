// Downloads each school's logo from an allowed source (ADRs 0006 and 0016), keeps the untouched download in
// data/seed/schools/logo-originals/, and stores a tidied copy in apps/web/public/logos (what the site serves).
// Usage: node fetch-logos.mjs [--refresh] [--rebuild] [--only slug,slug]
//   (default)   fetch logos that have no stored file yet
//   --refresh   download every logo again
//   --rebuild   no network: remake every stored file from its original (after changing the tidy rules or a crop)
// Every refusal is counted and printed; any refusal exits 1. One request at a time, robots.txt obeyed.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { isLightOnClear, tidy } from "./measure.mjs";

const ROOT = new URL("../../", import.meta.url);
export const IDENTITY = new URL("data/seed/schools/identity.json", ROOT);
export const LOGOS = new URL("apps/web/public/logos/", ROOT);
/** Small copies of the raster logos for lists, where a crest is drawn at 48px high or less (2x for sharp screens). */
export const SMALL = new URL("small/", LOGOS);
/** The untouched download of every logo, kept next to the edited file but outside apps/web/public, so never served (ADR 0016). */
export const ORIGINALS = new URL("data/seed/schools/logo-originals/", ROOT);
export const SMALL_BOX = { width: 288, height: 96 };
/** A stored raster fits inside this box: wide wordmarks keep at least ~160px of height where the source allows. */
export const STORED_BOX = { width: 1200, height: 320 };
const USER_AGENT = "Project80x40-logo-fetch/1.0";
const MAX_BYTES = 8_000_000; // the download; what is stored is shrunk to fit STORED_BOX
const PAUSE_MS = 400; // between requests; one at a time

/** School-website platforms that serve a district's images from their own CDN. Extend with care. */
export const CMS_HOSTS = [
  "finalsite.net", "edlio.com", "edliocloud.com", "schoolinsites.com", "thrillshare.com", "apptegy.net",
  "schoolwires.net", "schoolblocks.com", "cmsv2.com", "squarespace-cdn.com", "wixstatic.com", "wp.com",
  "googleusercontent.com", "s3.amazonaws.com", "cloudfront.net", "blackboard.com", "schoolmessenger.com",
  // Added once real school pages were read: each is the host behind a school site's own pages (logo page checked above).
  "files.smartsites.parentsquare.com", "cdn-website.com", "snappages.site", "sharpschool.com", "myschoolcdn.com",
  "digistormhosting.com.au", "teamsnapsites.com", "nxedge.io", "wsimg.com", "s3.us-west-2.amazonaws.com", "myconnectsuite.com",
  // Nov 11, 2026: eCatholic (Catholic school sites), The Church Co, Jersey Watch's image CDN, CPM school sites.
  "files.ecatholic.com", "media.thechurchcoassets.com", "res.cloudinary.com", "cpmfiles1.com",
];
/** Dave Campbell's Texas Football (ADR 0016): logo images only, from its team pages and image host, robots.txt obeyed. */
export const DCTF_HOSTS = ["texasfootball.com", "davecampbells.com"];
const BANNED = ["maxpreps.com", "hudl.com", "sixmanfootball.com", "calpreps.com", "wikipedia.org", "wikimedia.org"];

const hostOf = (url) => new URL(url).hostname.toLowerCase().replace(/^www\./, "");
const within = (host, domain) => host === domain || host.endsWith(`.${domain}`);
/** The last two labels, enough for .org, .net, .com and .us school domains alike (k12.tx.us keeps three). */
const site = (host) => host.split(".").slice(/\.(k12\.tx\.us|tx\.us)$/.test(host) ? -4 : -2).join(".");

/** A logo must come from the school's own site, its website platform or Dave Campbell's, and never from a banned source. */
export function sourceProblem({ site: schoolSite, logo }) {
  if (!logo?.image || !logo?.page) return "no logo image or page";
  for (const url of [logo.image, logo.page]) {
    if (!/^https?:\/\//.test(url)) return `not a web address: ${url}`;
    if (BANNED.some((b) => within(hostOf(url), b))) return `banned source: ${hostOf(url)}`;
  }
  const pageHost = hostOf(logo.page);
  const img = hostOf(logo.image);
  if (DCTF_HOSTS.some((d) => within(pageHost, d))) {
    return DCTF_HOSTS.some((d) => within(img, d)) ? null : `image host ${img} is not Dave Campbell's image host`;
  }
  if (!schoolSite) return "no school site to check the logo page against";
  const home = site(hostOf(schoolSite));
  if (site(pageHost) !== home) return `logo page ${pageHost} is not on the school site ${home}`;
  if (site(img) !== home && !CMS_HOSTS.some((c) => within(img, c))) return `image host ${img} is not the school site or a known school-site platform`;
  return null;
}

/** Type from the bytes, not the server's word. SVGs that could run code are refused. */
export function sniff(bytes) {
  const b = bytes;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { ext: "png" };
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: "jpg" };
  if (b.subarray(0, 4).toString() === "GIF8") return { ext: "gif" };
  if (b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP") return { ext: "webp" };
  const text = b.subarray(0, 4096).toString("utf8").trimStart().toLowerCase();
  if (text.startsWith("<svg") || (text.startsWith("<?xml") && b.toString("utf8").toLowerCase().includes("<svg"))) {
    const all = b.toString("utf8").toLowerCase();
    if (/<script|<foreignobject|<iframe|<embed|<object|\son[a-z]+\s*=|javascript:|href\s*=\s*(?:["'](?!#)|[^"'#\s>])/.test(all)) {
      return { error: "SVG contains script, event handlers, links or embedded content" };
    }
    return { ext: "svg" };
  }
  return { error: "not a PNG, JPEG, GIF, WebP or SVG image" };
}

/** The `*` group's rules of a robots.txt as { allow, path }. No site names our user agent, so `*` is the group that applies. */
export function parseRobots(text) {
  const rules = [];
  let applies = false;
  let sawRule = false;
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.replace(/#.*/, "").trim().match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    if (key === "user-agent") {
      if (sawRule) {
        applies = false;
        sawRule = false;
      }
      applies = applies || m[2].trim() === "*";
    } else if (key === "allow" || key === "disallow") {
      sawRule = true;
      if (applies && m[2].trim()) rules.push({ allow: key === "allow", path: m[2].trim() });
    }
  }
  return rules;
}

/** Longest matching rule wins; Allow beats Disallow on a tie; no matching rule means allowed. */
export function robotsAllowed(rules, path) {
  let best = null;
  for (const r of rules) {
    const pattern = r.path.replace(/[.+?^{}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\$$/, "$$");
    if (!new RegExp(`^${pattern}`).test(path)) continue;
    if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow)) best = r;
  }
  return !best || best.allow;
}

let sharp;
const robots = new Map();

/** Robots.txt of the URL's site, read once. A missing, unreachable or non-text robots.txt means no rules. */
async function robotsAllows(url) {
  const { origin, pathname, search } = new URL(url);
  if (!robots.has(origin)) {
    let rules = [];
    try {
      const res = await fetch(`${origin}/robots.txt`, { headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(15_000) });
      if (res.ok && (res.headers.get("content-type") ?? "").startsWith("text/plain")) rules = parseRobots(await res.text());
    } catch {
      // unreachable: treated as no rules, as crawlers do
    }
    robots.set(origin, rules);
  }
  return robotsAllowed(robots.get(origin), pathname + search);
}

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Makes the stored file from an original download: a hand-chosen crop (identity.json `crop`, pixels of the original),
 * then the automatic tidy (strip a solid background box, trim padding), then a shrink to fit STORED_BOX. SVGs are kept
 * as checked. `edit` is the plain-language note of what was done beyond shrinking, or undefined.
 */
export async function buildStored(sharp, bytes, ext, { crop, keepBackground } = {}) {
  if (ext === "svg") return { stored: bytes, ext: "svg", width: null, height: null, edit: undefined };
  const notes = [];
  let input = await sharp(bytes).ensureAlpha().png().toBuffer();
  if (crop) {
    input = await sharp(input).extract(crop).png().toBuffer();
    notes.push(`cropped by hand to the mark (${crop.width}x${crop.height} at ${crop.left},${crop.top} of the original)`);
  }
  const tidied = await tidy(sharp, input, { keepBackground });
  if (tidied.buffer) {
    input = tidied.buffer;
    notes.push(...tidied.notes);
  }
  const stored = await sharp(input).resize(STORED_BOX.width, STORED_BOX.height, { fit: "inside", withoutEnlargement: true }).png({ palette: true }).toBuffer();
  const { width, height } = await sharp(stored).metadata();
  return { stored, ext: "png", width, height, edit: notes.length ? `${notes.join("; ")}.` : undefined };
}

/** The small copy for lists, made from the stored file. */
const smallCopy = (stored) => sharp(stored).resize(SMALL_BOX.width, SMALL_BOX.height, { fit: "inside", withoutEnlargement: true }).png({ palette: true }).toBuffer();
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function download(school, today) {
  const problem = sourceProblem(school);
  if (problem) throw new Error(problem);
  for (const url of [school.logo.image, school.logo.page]) if (!(await robotsAllows(url))) throw new Error(`robots.txt disallows ${url}`);
  await pause(PAUSE_MS);
  const res = await fetch(school.logo.image, { headers: { "user-agent": USER_AGENT }, redirect: "follow", signal: AbortSignal.timeout(25_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > MAX_BYTES) throw new Error(`${bytes.length} bytes, over ${MAX_BYTES / 1e6} MB`);
  const kind = sniff(bytes);
  if (kind.error) throw new Error(kind.error);
  school.logo.retrievedOn = today;
  school.logo.sha256 = createHash("sha256").update(bytes).digest("hex");
  return { bytes, ext: kind.ext };
}

async function main() {
  // The sharp the web app already installs with Next; loaded here so the tests need no install.
  sharp = createRequire(new URL("apps/web/package.json", ROOT))("sharp");
  const refresh = process.argv.includes("--refresh");
  const rebuild = process.argv.includes("--rebuild");
  const onlyArg = process.argv.indexOf("--only");
  const only = onlyArg > 0 ? new Set(process.argv[onlyArg + 1].split(",")) : null;
  const data = JSON.parse(readFileSync(IDENTITY, "utf8"));
  const removed = new Set(data.removed ?? []);
  for (const dir of [LOGOS, ORIGINALS, SMALL]) mkdirSync(dir, { recursive: true });
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" }); // the project keeps Central dates
  const tally = { fetched: 0, rebuilt: 0, kept: 0, skipped: 0, refused: [] };
  let small = 0;

  for (const [slug, school] of Object.entries(data.schools)) {
    if (only && !only.has(slug)) continue;
    const logo = school.logo;
    if (removed.has(slug) || !logo) {
      if (logo?.file) for (const dir of [LOGOS, SMALL]) rmSync(new URL(logo.file, dir), { force: true });
      if (logo?.original) rmSync(new URL(logo.original, ORIGINALS), { force: true });
      if (logo) for (const key of ["file", "original", "edit", "aspect", "light"]) delete logo[key];
      tally.skipped += 1;
      continue;
    }
    const haveOriginal = Boolean(logo.original) && existsSync(new URL(logo.original, ORIGINALS));
    const haveStored = Boolean(logo.file) && existsSync(new URL(logo.file, LOGOS));
    if (haveStored && haveOriginal && !refresh && !rebuild) {
      tally.kept += 1;
      continue;
    }
    if (rebuild && !haveOriginal) continue; // nothing to rebuild from; the next plain run downloads it
    try {
      const fromDisk = haveOriginal && !refresh;
      const { bytes, ext } = fromDisk ? { bytes: readFileSync(new URL(logo.original, ORIGINALS)), ext: logo.original.split(".").pop() } : await download(school, today);
      const built = await buildStored(sharp, bytes, ext, logo);
      const file = `${slug}.${built.ext}`;
      const original = `${slug}.${ext}`;
      for (const e of ["png", "jpg", "gif", "webp", "svg"]) {
        rmSync(new URL(`${slug}.${e}`, LOGOS), { force: true });
        rmSync(new URL(`${slug}.${e}`, SMALL), { force: true });
        if (`${slug}.${e}` !== original) rmSync(new URL(`${slug}.${e}`, ORIGINALS), { force: true });
      }
      writeFileSync(new URL(original, ORIGINALS), bytes);
      writeFileSync(new URL(file, LOGOS), built.stored);
      if (built.ext === "png") {
        writeFileSync(new URL(file, SMALL), await smallCopy(built.stored));
        small += 1;
      }
      // aspect and light are measured on the stored file, after trimming (an SVG keeps its recorded aspect)
      const aspect = built.width ? round2(built.width / built.height) : logo.aspect ?? 1;
      const light = await isLightOnClear(sharp, built.stored);
      Object.assign(logo, { file, original, aspect, light });
      if (built.edit) logo.edit = built.edit;
      else delete logo.edit;
      tally[fromDisk ? "rebuilt" : "fetched"] += 1;
    } catch (error) {
      tally.refused.push(`${slug}: ${error.message}`);
    }
  }

  // A small copy for any stored raster that has none yet.
  for (const [slug, school] of Object.entries(data.schools)) {
    const file = school.logo?.file;
    if (!file?.endsWith(".png") || removed.has(slug) || existsSync(new URL(file, SMALL)) || !existsSync(new URL(file, LOGOS))) continue;
    writeFileSync(new URL(file, SMALL), await smallCopy(readFileSync(new URL(file, LOGOS))));
    small += 1;
  }

  writeFileSync(IDENTITY, `${JSON.stringify(data, null, 2)}\n`);
  console.log(`logos: ${small} small copies made`);
  console.log(`logos: ${tally.fetched} fetched, ${tally.rebuilt} rebuilt from originals, ${tally.kept} kept, ${tally.skipped} without a logo, ${tally.refused.length} refused`);
  for (const line of tally.refused) console.log(`  refused ${line}`);
  if (tally.refused.length) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
