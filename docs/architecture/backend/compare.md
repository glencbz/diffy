# Comparing two files by hand

A reader can compare any after-side file of a row with any before-side file,
for a rename jj did not detect or a file split in two. The diff jj computed
pairs files by path, so this module diffs one named pair outside it, in the
same `FileDiff` shape every other diff takes.

A row's sides are commits: the older commit and the newer one in an
interdiff, or a commit's parent and the commit itself for a lone commit. Both
sides are read as whole trees from git's store. An interdiff's own before
side is the older change rebased onto the newer one's parent, which exists
only inside jj, so a compared pair also shows whatever the base moved under
the file. Reading the real older commit is what makes "where did this code go
since the last version" answerable at all.

The answer is a [`git`-format patch](jj.md#reading-a-commits-diff) written as
a rename, so `parseFileDiff` reads it into the same shape and the frontend
draws, comments on, and marks it viewed like any renamed file. git diffs the
two blobs; its header names them by id, so only its hunks are kept and the
header is written here with the real paths.

```ts
//| id: compare-module
//| file: src/backend/commit/compare.ts
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { $ } from "bun";
import { difftFile } from "./difft";
import type { GitOid } from "./git";
import { type JjFileDiff, parseFileDiff } from "./jj";

/** A pair that cannot be compared: a side with no tree, or a path the side
 *  does not hold. */
export class CompareError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompareError";
  }
}

/** A row's two commits: the older one, or none for a commit's own diff. */
export interface CompareSides {
  from: GitOid | null;
  to: GitOid;
}

/** The commit a row's before side is read from, or null for a root commit's
 *  own diff, whose before side is empty. */
async function beforeCommit(
  root: string,
  { from, to }: CompareSides,
): Promise<string | null> {
  if (from !== null) return from;
  const parent = await $`git rev-parse --verify --quiet ${`${to}^`}`
    .cwd(root)
    .quiet()
    .nothrow();
  return parent.exitCode === 0 ? parent.text().trim() : null;
}

/** Every file in the before side's tree. */
export async function beforePaths(
  root: string,
  sides: CompareSides,
): Promise<string[]> {
  const commit = await beforeCommit(root, sides);
  if (commit === null) return [];
  const listed = await $`git ls-tree -r -z --full-tree --name-only ${commit}`
    .cwd(root)
    .quiet()
    .nothrow();
  if (listed.exitCode !== 0) {
    throw new CompareError(`git cannot read the tree of ${commit}`);
  }
  return listed
    .text()
    .split("\0")
    .filter((path) => path !== "");
}

async function blobAt(
  root: string,
  commit: string,
  path: string,
): Promise<string> {
  const found = await $`git rev-parse --verify --quiet ${`${commit}:${path}`}`
    .cwd(root)
    .quiet()
    .nothrow();
  if (found.exitCode !== 0) {
    throw new CompareError(`${path} is not in ${commit.slice(0, 8)}`);
  }
  return found.text().trim();
}

/** `oldPath` on the before side against `newPath` on the after side. */
export async function compareFiles(
  root: string,
  sides: CompareSides,
  oldPath: string,
  newPath: string,
): Promise<JjFileDiff> {
  const before = await beforeCommit(root, sides);
  if (before === null) {
    throw new CompareError("a root commit has nothing before it to compare");
  }
  const [oldBlob, newBlob] = await Promise.all([
    blobAt(root, before, oldPath),
    blobAt(root, sides.to, newPath),
  ]);

  const diff = await $`git diff --no-color --no-ext-diff ${oldBlob} ${newBlob}`
    .cwd(root)
    .quiet()
    .text();
  const binary = /^Binary files /m.test(diff);
  const hunks = diff.search(/^@@/m);
  const body = binary
    ? `Binary files a/${oldPath} and b/${newPath} differ\n`
    : hunks === -1
      ? ""
      : `--- a/${oldPath}\n+++ b/${newPath}\n${diff.slice(hunks)}`;
  const patch = [
    `diff --git a/${oldPath} b/${newPath}`,
    `rename from ${oldPath}`,
    `rename to ${newPath}`,
    `index ${oldBlob}..${newBlob}`,
    "",
  ].join("\n");

  return {
    ...parseFileDiff(patch + body),
    structural: binary
      ? { kind: "unavailable", reason: "binary file" }
      : await structural(root, oldBlob, oldPath, newBlob, newPath),
  };
}

/** Difftastic picks a language by file name, so each blob is written out
 *  under its own. */
async function structural(
  root: string,
  oldBlob: string,
  oldPath: string,
  newBlob: string,
  newPath: string,
): Promise<JjFileDiff["structural"]> {
  const dir = await mkdtemp(join(tmpdir(), "diffy-compare-"));
  try {
    const left = join(dir, "before", basename(oldPath));
    const right = join(dir, "after", basename(newPath));
    await Promise.all([mkdir(join(dir, "before")), mkdir(join(dir, "after"))]);
    await Promise.all([
      Bun.write(
        left,
        await $`git cat-file blob ${oldBlob}`.cwd(root).quiet().blob(),
      ),
      Bun.write(
        right,
        await $`git cat-file blob ${newBlob}`.cwd(root).quiet().blob(),
      ),
    ]);
    return await difftFile(left, right);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
```

## Test

The tests read [fixed commits](../../devtools/testing.md) of this repository.

```ts
//| id: compare-module-test
//| file: src/backend/commit/compare.test.ts
import { describe, expect, test } from "bun:test";
import { $ } from "bun";
import { FIXED } from "../../testing/history";
import { beforePaths, CompareError, compareFiles } from "./compare";
import { GitOid } from "./git";

/** The repository these tests read. */
const ROOT = process.cwd();
const COMMIT = GitOid.parse(FIXED.commit);
const PARENT = GitOid.parse(FIXED.parent);

describe("compareFiles", () => {
  test("diffs two paths as a rename, with the blobs each side holds", async () => {
    // arrange
    const to = COMMIT;
    const oldBlob = (
      await $`git rev-parse ${PARENT}:package.json`.quiet().text()
    ).trim();

    // act
    const file = await compareFiles(
      ROOT,
      { from: null, to },
      "package.json",
      "tsconfig.json",
    );

    // assert
    expect(file.status).toBe("renamed");
    expect(file).toMatchObject({
      oldPath: "package.json",
      newPath: "tsconfig.json",
      oldBlob,
      binary: false,
    });
    expect(file.patch).toContain("\n@@ ");
  });

  test("reads the older commit's tree when the row has one", async () => {
    // arrange
    const [from, to] = [PARENT, COMMIT];

    // act
    const file = await compareFiles(ROOT, { from, to }, "justfile", "justfile");

    // assert
    expect(file.oldBlob).toBe(
      (await $`git rev-parse ${PARENT}:justfile`.quiet().text()).trim(),
    );
  });

  test("refuses a path the side does not hold", async () => {
    // arrange
    const to = COMMIT;

    // act
    const compared = compareFiles(
      ROOT,
      { from: null, to },
      "no/such/file.ts",
      "package.json",
    );

    // assert
    expect(compared).rejects.toBeInstanceOf(CompareError);
  });
});

describe("beforePaths", () => {
  test("lists the parent's tree for a commit's own diff", async () => {
    // arrange
    const to = COMMIT;

    // act
    const paths = await beforePaths(ROOT, { from: null, to });

    // assert
    expect(paths).toContain("package.json");
    expect(paths).toContain("docs/architecture/backend/git.md");
  });
});
```
