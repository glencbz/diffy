// ~/~ begin <<docs/architecture/backend/git.md#git-module>>[init]
import { $ } from "bun";
import * as z from "zod";

/** A full 40-hex git object id. Abbreviations are refused. */
export const GitOid = z
  .string()
  .regex(/^[0-9a-f]{40}$/, "expected a full 40-character git object id")
  .brand("GitOid");
export type GitOid = z.infer<typeof GitOid>;

/** One commit as the browser reads it. */
export interface GitCommit {
  commitId: GitOid;
  parents: GitOid[];
  /** Full commit message, subject and body, matching JjLogEntry.description. */
  description: string;
  author: string;
  /** ISO 8601 author date. */
  authoredAt: string;
  /** What lines this commit up against another across a rewrite: its jj
   *  change id, or null when it has none. */
  changeId: string | null;
}
// ~/~ end
// ~/~ begin <<docs/architecture/backend/git.md#git-module>>[1]

/** A git blob id, whole or abbreviated the way a patch's `index` line prints it. */
export const BlobId = z
  .string()
  .regex(/^[0-9a-f]{4,64}$/, "expected a hex git blob id")
  .brand("BlobId");
export type BlobId = z.infer<typeof BlobId>;

/** A blob's contents as text, or null when the store has no one blob by that id. */
export async function gitBlob(
  root: string,
  id: BlobId,
): Promise<string | null> {
  const result = await $`git cat-file blob ${id}`.cwd(root).quiet().nothrow();
  return result.exitCode === 0 ? result.text() : null;
}
// ~/~ end
// ~/~ begin <<docs/architecture/backend/git.md#git-module>>[2]

/** Every file `revision`'s tree holds, or none when git cannot name it. */
export async function gitFiles(
  root: string,
  revision: string,
): Promise<string[]> {
  const result = await $`git ls-tree -r -z --full-tree --name-only ${revision}`
    .cwd(root)
    .quiet()
    .nothrow();
  if (result.exitCode !== 0) return [];
  return result
    .text()
    .split("\0")
    .filter((path) => path !== "");
}
// ~/~ end
