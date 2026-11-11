// ~/~ begin <<docs/architecture/backend/git.md#git-module>>[init]
import { $ } from "bun";
import type { BlobId } from "../../model/history";
// ~/~ end
// ~/~ begin <<docs/architecture/backend/git.md#git-module>>[1]

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
