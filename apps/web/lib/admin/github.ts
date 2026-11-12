// The console's only way to change the site's data: a commit to main through GitHub's contents API, with a narrow
// fine-grained token (GITHUB_CORRECTIONS_TOKEN: contents read and write on this one repository). No imports, so the node
// tests run it against a fake `fetch`.
//
// WRITES go to two hard-coded paths under data/corrections/, chosen by name (`CorrectionFile`), never by a path from a
// request. READS may also fetch the game and alignment files the console searches, from an allowlist: the site's own
// files are read here, live from main, because a serverless page cannot count on files outside apps/web at run time and
// a search should see the Results watch robot's latest commit, not the last build.

const REPO = "txsixman/txsixmanfootball";
const API = `https://api.github.com/repos/${REPO}/contents`;

export const CORRECTION_FILES = {
  games: "data/corrections/games.csv",
  programs: "data/corrections/programs.csv",
} as const;
export type CorrectionFile = keyof typeof CORRECTION_FILES;

const READABLE = [
  /^data\/corrections\/(games|programs)\.csv$/,
  /^data\/seed\/maxpreps-20\d\d\/games\.csv$/,
  /^data\/seed\/(uil-2026-28|tapps-2026-28|private-2026)\/alignments\.csv$/,
];

export class GithubError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "GithubError";
    this.status = status;
  }
}

/** Another commit landed on the file between our read and our write (the Results watch robot commits to main too). */
export class Conflict extends Error {
  constructor() {
    super("The file changed while saving");
    this.name = "Conflict";
  }
}

type Fetch = typeof fetch;

/** The one place a write path comes from: the two hard-coded names, whatever `kind` a caller passes. */
function correctionPath(kind: string): string {
  if (!Object.hasOwn(CORRECTION_FILES, kind)) throw new Error(`not a correction file: ${kind}`);
  return CORRECTION_FILES[kind as CorrectionFile];
}

export function repoClient(token: string, fetchImpl: Fetch = fetch) {
  const call = (url: string, init: RequestInit = {}) =>
    fetchImpl(url, {
      ...init,
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "txsixmanfootball-admin",
        ...init.headers,
      },
    });
  // Errors say what failed and the status, never the token or the response body (which can echo a request).
  const fail = (what: string, status: number): never => {
    const hint = status === 401 || status === 403 || status === 404 ? " (check GITHUB_CORRECTIONS_TOKEN and its repository access)" : "";
    throw new GithubError(`GitHub: ${what} failed with status ${status}${hint}`, status);
  };

  /** A file's text from main, or null when it does not exist. Only paths on the READABLE list. */
  async function readText(path: string): Promise<string | null> {
    if (!READABLE.some((re) => re.test(path))) throw new Error(`not a readable path: ${path}`);
    const res = await call(`${API}/${path}?ref=main`, { headers: { Accept: "application/vnd.github.raw+json" } });
    if (res.status === 404) return null;
    if (!res.ok) fail(`reading ${path}`, res.status);
    return res.text();
  }

  /** A correction file's text and blob sha (the version a write must start from), or null when it does not exist yet. */
  async function readCorrectionFile(kind: CorrectionFile): Promise<{ text: string; sha: string } | null> {
    const path = correctionPath(kind);
    const res = await call(`${API}/${path}?ref=main`, { headers: { Accept: "application/vnd.github+json" } });
    if (res.status === 404) return null;
    if (!res.ok) fail(`reading ${path}`, res.status);
    const body = (await res.json()) as { sha?: unknown; content?: unknown; encoding?: unknown };
    // shortcut: the contents API sends a file inline up to 1 MB (about 3,000 correction rows); upgrade: switch to the git blobs API when this throws.
    if (typeof body.sha !== "string" || typeof body.content !== "string" || body.encoding !== "base64") {
      throw new GithubError(`GitHub: ${path} is too large to edit here`, 413);
    }
    return { text: Buffer.from(body.content, "base64").toString("utf8"), sha: body.sha };
  }

  /**
   * Change one correction file with `edit` (old text, or the header-only text of a new file → the whole new text) and
   * commit it to main with `message`. The file's sha makes the write optimistic: if the robot or another edit committed
   * in between, GitHub refuses and this reads again and re-applies `edit`, up to `attempts` times, then throws Conflict.
   */
  async function editCorrectionFile(
    kind: CorrectionFile,
    header: string,
    edit: (text: string) => string,
    message: string,
    attempts = 3,
  ): Promise<{ commit: string }> {
    const path = correctionPath(kind);
    for (let i = 0; i < attempts; i += 1) {
      const current = await readCorrectionFile(kind);
      const next = edit(current?.text ?? `${header}\n`);
      const res = await call(`${API}/${path}`, {
        method: "PUT",
        headers: { Accept: "application/vnd.github+json", "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          content: Buffer.from(next, "utf8").toString("base64"),
          branch: "main",
          ...(current ? { sha: current.sha } : {}),
        }),
      });
      if (res.ok) {
        const body = (await res.json()) as { commit?: { sha?: unknown } };
        return { commit: typeof body.commit?.sha === "string" ? body.commit.sha : "" };
      }
      // 409: the sha is stale. 422: a new file was created meanwhile (we sent no sha). Either way, read again.
      if (res.status !== 409 && res.status !== 422) fail(`writing ${path}`, res.status);
    }
    throw new Conflict();
  }

  return { readText, readCorrectionFile, editCorrectionFile };
}
