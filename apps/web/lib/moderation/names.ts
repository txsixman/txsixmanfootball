import { isBlocked, normalize, strip } from "./check.ts";

// A display name is held to the same word list as posts, and the names that pretend to be the site are reserved. The
// database refuses both too (create_profile and moderation_reserved_name in migration 0013); this copy gives the answer
// before the call. The accounts round's stand-in for this file had the same one export; it was replaced by the posts
// round (ADR 0018).

// Names that pretend to be the site. A name holds one of these as a whole word, or spells one with its letters run together.
const RESERVED = ["admin", "administrator", "moderator", "mod", "staff", "official", "support", "txsixman", "sixman", "80x40"];

// Refused anywhere in a name once look-alikes and separators are gone, and refused as a whole word (inside other words they
// are harmless: "Spicewood", "Raccoon", "Chinkapin"). The sign-up round's lists, kept on top of the posts' word list.
const NAME_ANYWHERE = ["nigger", "nigga", "faggot", "tranny", "retard", "wetback", "nazi", "hitler"];
const NAME_WHOLE = ["fag", "fags", "chink", "spic", "kike", "coon", "gook", "beaner", "dyke", "kkk", "rapist"];

/** The name read plainly, and read through the posts' folding (4dm1n). */
const views = (name: string) => [strip(name).replace(/[^a-z0-9]+/g, " ").trim(), normalize(name)];

/** Twin of moderation_reserved_name(). */
function reservedName(name: string): boolean {
  return views(name).some((words) => RESERVED.some((r) => words.split(" ").includes(r) || words.replace(/ /g, "") === r));
}

/** Twin of moderation_name_blocked(). */
function nameBlocked(name: string): boolean {
  const [plain, folded] = views(name);
  return isBlocked(name) || NAME_ANYWHERE.some((w) => folded.replace(/ /g, "").includes(w)) || [plain, folded].some((words) => words.split(" ").some((w) => NAME_WHOLE.includes(w)));
}

export function displayNameProblem(name: string): string | null {
  if (nameBlocked(name)) return "Pick a different name. That one is not allowed.";
  if (reservedName(name)) return "Pick a different name. That one is reserved.";
  return null;
}
