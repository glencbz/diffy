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

/** Oids the store does not hold, in the order given. */
async function absentFrom(oids: GitOid[]): Promise<GitOid[]> {
  const present = await Promise.all(oids.map(gitHasCommit));
  return oids.filter((_, index) => present[index] === false);
}

/**
 * Ensure every oid is in the local object store, fetching what is missing, and
 * return each one as a `LocalOid` in the order asked.
 */
export async function gitMaterialize(
  oids: GitOid[],
  remote = "origin",
): Promise<LocalOid[]> {
  const missing = await absentFrom([...new Set(oids)]);

  if (missing.length > 0) {
    const refspecs = missing.map((oid) => `${oid}:refs/diffy/commits/${oid}`);
    const fetch = await $`git fetch --no-tags ${remote} ${refspecs}`
      .quiet()
      .nothrow();

    const stillMissing = await absentFrom(missing);
    if (stillMissing.length > 0) {
      const said = fetch.stderr.toString().trim();
      throw new GitError(
        `${remote} did not deliver ${stillMissing.join(", ")}${said === "" ? "" : `: ${said}`}`,
        fetch.exitCode,
      );
    }
  }

  return oids as LocalOid[];
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

/** Exported for unit tests: turn one NUL-terminated log record into a commit. */
export function parseLogRecord(record: string): GitCommit {
  const fields = record.split("\x1f");
  if (fields.length < 5) {
    throw new Error(
      `gitLog: expected 5 fields, got ${fields.length} in: ${record}`,
    );
  }
  const [commitId = "", parents = "", author = "", authoredAt = ""] = fields;

  return {
    commitId: GitOid.parse(commitId),
    parents:
      parents === "" ? [] : parents.split(" ").map((p) => GitOid.parse(p)),
    // The body is last, so a separator inside a commit message rejoins here
    // rather than failing the whole record.
    description: fields.slice(4).join("\x1f"),
    author,
    authoredAt,
  };
}
// ~/~ end
