// One-time setup of the site's push keys (VAPID). The owner runs it once, on the owner's Mac, from the repo root:
//   node tools/push/setup-vapid.mjs
// It makes a new key pair with web-push, stores the private half in the owner's Keychain (project-80x40-vapid-private) and
// in the VAPID_PRIVATE_KEY repo secret, and writes the public half into the two files that carry it. The private key
// is never printed or written to disk. If the Keychain already holds a key it stops; `--rotate` replaces it (everyone
// following a program must then tap Follow again).
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import * as webpush from "web-push";

const ROOT = path.resolve(import.meta.dirname, "../..");
const REPO = "txsixman/txsixmanfootball";
const SERVICE = "project-80x40-vapid-private";
const CARRIERS = ["tools/push/send-finals.mjs", "apps/web/lib/push.ts"];

const hasKey = () => {
  try {
    execFileSync("security", ["find-generic-password", "-a", "vapid", "-s", SERVICE], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

if (hasKey() && !process.argv.includes("--rotate")) {
  console.error(`The Keychain already holds ${SERVICE}; nothing changed. Pass --rotate to replace it.`);
  process.exit(1);
}

const { publicKey, privateKey } = webpush.generateVAPIDKeys();
try {
  execFileSync("security", ["add-generic-password", "-U", "-a", "vapid", "-s", SERVICE, "-w", privateKey], { stdio: "ignore" });
} catch (e) {
  // Not rethrown as is: Node's own message repeats the command line, key included.
  console.error(`Could not write ${SERVICE} to the Keychain (security exited ${e.status}); nothing was stored.`);
  process.exit(1);
}
const token = execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
execFileSync("gh", ["secret", "set", "VAPID_PRIVATE_KEY", "-R", REPO], {
  input: privateKey,
  env: { ...process.env, GH_TOKEN: token },
  stdio: ["pipe", "inherit", "inherit"],
});

for (const file of CARRIERS) {
  const full = path.join(ROOT, file);
  const text = readFileSync(full, "utf8");
  const next = text.replace(/(VAPID_PUBLIC_KEY = ")[^"]*(")/, `$1${publicKey}$2`);
  if (next === text) throw new Error(`no VAPID_PUBLIC_KEY line in ${file}`);
  writeFileSync(full, next);
}
console.log(`Private key: Keychain (${SERVICE}) and the VAPID_PRIVATE_KEY repo secret.`);
console.log(`Public key ${publicKey} written to ${CARRIERS.join(" and ")}.`);
