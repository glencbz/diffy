// ~/~ begin <<docs/architecture/backend/git.md#git-module>>[init]
import { $ } from "bun";
import * as z from "zod";

/** A full 40-hex git object id. Abbreviations are refused: fetch-by-oid needs all 40. */
export const GitOid = z
  .string()
  .regex(/^[0-9a-f]{40}$/, "expected a full 40-character git object id")
  .brand("GitOid");
export type GitOid = z.infer<typeof GitOid>;

declare const presentLocally: unique symbol;
/** A GitOid proven to be in this repo's object store. Only `gitMaterialize` mints one. */
export type LocalOid = GitOid & { readonly [presentLocally]: true };

/**
 * A path under `refs/diffy/`. Names where a pin lives and what `gitForget`
 * collects, so it is the thing that decides when an object may go.
 */
export const RefPath = z
  .string()
  .regex(/^[a-z0-9][a-z0-9/_-]*$/, "expected a ref path such as pull/42/v3")
  .brand("RefPath");
export type RefPath = z.infer<typeof RefPath>;

/** An object to obtain, and the ref that will keep it alive once obtained. */
export interface GitPin {
  at: RefPath;
  oid: GitOid;
}

/** `git` exited non-zero, or a fetch completed without delivering the objects. */
export class GitError extends Error {
  constructor(
    message: string,
    readonly exitCode: number,
  ) {
    super(message);
    this.name = "GitError";
  }
}

/** One commit as the local object store has it. */
export interface GitCommit {
  commitId: GitOid;
  parents: GitOid[];
  /** Full commit message, subject and body, matching JjLogEntry.description. */
  description: string;
  author: string;
  /** ISO 8601 author date. */
  authoredAt: string;
  /** What lines this commit up against another across a rewrite. Git records
   *  nothing durable here, so it is derived from the subject line, and it is
   *  null when there is no subject. */
  changeId: string | null;
}
// ~/~ end
// ~/~ begin <<docs/architecture/backend/git.md#git-module>>[1]

/** Whether the object store already holds `oid` as a commit. Never hits the network. */
export async function gitHasCommit(oid: GitOid): Promise<boolean> {
  const spec = `${oid}^{commit}`;
  const result = await $`git cat-file -e ${spec}`.quiet().nothrow();
  return result.exitCode === 0;
}
// ~/~ end
// ~/~ begin <<docs/architecture/backend/git.md#git-module>>[2]

/** Pins whose object the store does not hold, one per distinct oid. */
async function absentPins(pins: GitPin[]): Promise<GitPin[]> {
  const unique = [...new Map(pins.map((pin) => [pin.oid, pin])).values()];
  const present = await Promise.all(unique.map((pin) => gitHasCommit(pin.oid)));
  return unique.filter((_, index) => present[index] === false);
}

/**
 * Ensure every oid is in the local object store, fetching what is missing, and
 * return each one as a `LocalOid` in the order asked.
 */
export async function gitMaterialize(
  pins: GitPin[],
  remote = "origin",
): Promise<LocalOid[]> {
  const missing = await absentPins(pins);

  if (missing.length > 0) {
    const refspecs = missing.map((pin) => `${pin.oid}:refs/diffy/${pin.at}`);
    const fetch = await $`git fetch --no-tags ${remote} ${refspecs}`
      .quiet()
      .nothrow();

    const stillMissing = await absentPins(missing);
    if (stillMissing.length > 0) {
      const said = fetch.stderr.toString().trim();
      const lost = stillMissing.map((pin) => pin.oid).join(", ");
      throw new GitError(
        `${remote} did not deliver ${lost}${said === "" ? "" : `: ${said}`}`,
        fetch.exitCode,
      );
    }
  }

  return pins.map((pin) => pin.oid) as LocalOid[];
}

/** Drop the pins under a path, so `git gc` can reclaim what nothing else holds. */
export async function gitForget(prefix: RefPath): Promise<number> {
  const args = ["for-each-ref", "--format=%(refname)", `refs/diffy/${prefix}/`];
  const listed = await $`git ${args}`.quiet().nothrow();
  if (listed.exitCode !== 0) {
    throw new GitError(
      listed.stderr.toString().trim() ||
        `git for-each-ref exited ${listed.exitCode}`,
      listed.exitCode,
    );
  }

  const refs = listed
    .text()
    .split("\n")
    .filter((ref) => ref.length > 0);
  if (refs.length === 0) return 0;

  const script = Buffer.from(refs.map((ref) => `delete ${ref}\n`).join(""));
  const dropped = await $`git update-ref --stdin < ${script}`.quiet().nothrow();
  if (dropped.exitCode !== 0) {
    throw new GitError(
      dropped.stderr.toString().trim() ||
        `git update-ref exited ${dropped.exitCode}`,
      dropped.exitCode,
    );
  }

  return refs.length;
}
// ~/~ end
// ~/~ begin <<docs/architecture/backend/git.md#git-module>>[3]

export interface GitLogRange {
  /** Exclusive lower bound: `git log <from>..<to>`. Omit for all ancestors of `to`. */
  from?: LocalOid | undefined;
  to: LocalOid;
  limit?: number | undefined;
}

const LOG_FORMAT = "%H%x1f%P%x1f%an%x1f%aI%x1f%B";

/** Read commits from the local store, newest first, matching `jj log` order. */
export async function gitLog(range: GitLogRange): Promise<GitCommit[]> {
  const args = ["log", "--no-color", "-z", `--format=${LOG_FORMAT}`];
  if (range.limit !== undefined) args.push("-n", String(range.limit));
  args.push(range.from === undefined ? range.to : `${range.from}..${range.to}`);

  const result = await $`git ${args}`.quiet().nothrow();
  if (result.exitCode !== 0) {
    const said = result.stderr.toString().trim();
    throw new GitError(
      said || `git log exited ${result.exitCode}`,
      result.exitCode,
    );
  }

  return result
    .text()
    .split("\0")
    .filter((record) => record.length > 0)
    .map(parseLogRecord);
}

/** The subject line, the closest thing to a stable identity git offers.
 *  Null when the commit has no subject to derive one from. */
export function subjectIdentity(description: string): string | null {
  const subject = description.split("\n")[0]?.trim() ?? "";
  return subject === "" ? null : subject;
}

/** Exported for unit tests: turn one NUL-terminated log record into a commit. */
export function parseLogRecord(record: string): GitCommit {
  const fields = record.split("\x1f");
  if (fields.length < 5) {
    throw new Error(
      `gitLog: expected 5 fields, got ${fields.length} in: ${record}`,
    );
  }
  const [commitId = "", parents = "", author = "", authoredAt = ""] = fields;
  // The body is last, so a separator inside a commit message rejoins here
  // rather than failing the whole record.
  const description = fields.slice(4).join("\x1f");

  return {
    commitId: GitOid.parse(commitId),
    parents:
      parents === "" ? [] : parents.split(" ").map((p) => GitOid.parse(p)),
    description,
    author,
    authoredAt,
    changeId: subjectIdentity(description),
  };
}
// ~/~ end
// ~/~ begin <<docs/architecture/backend/git.md#git-module>>[4]

/** The commit two heads share, which is where a branch and its base diverged. */
export async function gitMergeBase(
  a: LocalOid,
  b: LocalOid,
): Promise<LocalOid> {
  const result = await $`git merge-base ${a} ${b}`.quiet().nothrow();
  const shared = result.text().trim();

  if (result.exitCode !== 0 || shared === "") {
    const said = result.stderr.toString().trim();
    throw new GitError(
      said || `${a} and ${b} share no ancestor`,
      result.exitCode,
    );
  }

  return GitOid.parse(shared) as LocalOid;
}
// ~/~ end
// ~/~ begin <<docs/architecture/backend/git.md#git-module>>[5]

/** A git blob id, whole or abbreviated the way a patch's `index` line prints it. */
export const BlobId = z
  .string()
  .regex(/^[0-9a-f]{4,64}$/, "expected a hex git blob id")
  .brand("BlobId");
export type BlobId = z.infer<typeof BlobId>;

/** A blob's contents as text, or null when the store has no one blob by that id. */
export async function gitBlob(id: BlobId): Promise<string | null> {
  const result = await $`git cat-file blob ${id}`.quiet().nothrow();
  return result.exitCode === 0 ? result.text() : null;
}
// ~/~ end
