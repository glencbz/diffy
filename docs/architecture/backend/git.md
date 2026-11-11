# Local git object store

File content comes from the local git object store via the `git` CLI: a
blob's contents and the files of a commit's tree. `GitCommit` is the shape in
which [local reviews](local-reviews.md) hand commits to the browser.

Every function takes the workspace root to run git in, as the
[jj backend](jj.md) does.

```ts
//| id: git-module
//| file: src/backend/commit/git.ts
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
```

### Reading a file's contents

Highlighting and expanded context need whole files. The `index` line of every
[`git`-format patch](jj.md#reading-a-commits-diff) names each side's blob, and
in a colocated repo the blob is in git's store. `BlobId` accepts the
abbreviated ids that line prints; an unknown or ambiguous id answers null.

```ts
//| id: git-module

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
```

#### Test

The tests drive the real CLI against [fixed commits](../../devtools/testing.md)
of this repository.

```ts
//| id: git-module-test
//| file: src/backend/commit/git.test.ts
import { describe, expect, test } from "bun:test";
import { $ } from "bun";
import { FIXED } from "../../testing/history";
import { BlobId, GitOid, gitBlob, gitFiles } from "./git";

/** The repository these tests read. */
const ROOT = process.cwd();

const COMMIT = GitOid.parse(FIXED.commit);

describe("gitBlob", () => {
  test("reads a file back by the blob id a tree holds it under", async () => {
    // arrange
    const id = BlobId.parse(
      (await $`git rev-parse ${COMMIT}:package.json`.quiet().text()).trim(),
    );

    // act
    const text = await gitBlob(ROOT, id);

    // assert
    expect(text).toBe(await $`git show ${COMMIT}:package.json`.quiet().text());
  });

  test("answers null for an id that names nothing", async () => {
    // arrange
    // act
    // assert
    expect(await gitBlob(ROOT, BlobId.parse("f".repeat(40)))).toBeNull();
  });
});
```

### Listing a commit's files

A [run](runs.md#which-file-ran) keeps the lines it ran against the files of the
commit it played, so it needs every path the commit's tree holds, not only
the ones its diff touches. A revision git cannot name has no files.

```ts
//| id: git-module

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
```

#### Test

```ts
//| id: git-module-test

describe("gitFiles", () => {
  test("lists a commit's tree, nested paths included", async () => {
    // arrange
    const head = COMMIT;

    // act
    const files = await gitFiles(ROOT, head);

    // assert
    expect(files).toContain("package.json");
    expect(files).toContain("src/server.ts");
  });

  test("lists nothing for a revision git cannot name", async () => {
    // arrange
    // act
    // assert
    expect(await gitFiles(ROOT, "f".repeat(40))).toEqual([]);
  });
});
```
