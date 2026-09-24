# File tree

A diff with a handful of files reads fine top to bottom. One with dozens
does not: a reader who wants `src/server.ts` has to scroll past everything
that sorts before it. This is the summary that answers "what changed" before
the patch does, and the navigator that jumps straight to a file from
anywhere in it. Both draw the same folded tree, so a reader learns its shape
once.

## Folding a diff's files into a tree

`FileDiff` names a file by its wire shape: `path` for an add, a delete, or
an edit, `oldPath`/`newPath` for a rename or a copy. Every reader of the
tree wants the same few facts regardless of which shape they came from, so
`ChangedFile` is that shape read once, up front, rather than a union every
caller re-narrows.

`anchor` is the DOM id of the file's own `<section>` in the diff below. It
is what the tree and the navigator jump to, and `fileAnchor` is the one
function that spells it: a scope (the row a comparison sits in, or the
commit a stack row is) and the file's own after-side path, so the same file
in two different rows still gets two different ids.

```ts
//| id: frontend-view-changed-files
//| file: src/frontend/views/changedFiles.ts
import type { FileDiff } from "../api";
import type { RowComment } from "../state/review";
import { readPatch } from "./patch";

/** One changed file, read once from whichever `FileDiff` shape it came
 *  from, for every reader that only wants to know what changed. */
export interface ChangedFile {
  /** DOM id of the file's `<section>` in the diff below. */
  anchor: string;
  /** The after-side path: `newPath` for a rename or a copy. */
  path: string;
  /** `oldPath` for a rename or a copy, else null. */
  from: string | null;
  status: FileDiff["status"];
  added: number;
  removed: number;
  binary: boolean;
  /** Unresolved comments on `path`. */
  openComments: number;
}

/** A folder's `name` may itself be `a/b/c`: a chain of folders that each
 *  hold one folder and nothing else, folded into the one row that chain
 *  reads as. */
export type TreeNode =
  | { kind: "folder"; name: string; children: TreeNode[] }
  | { kind: "file"; name: string; file: ChangedFile };

/** A DOM id unique to one file within one scope: a comparison row's key, or
 *  a pull request stack's commit id. */
export function fileAnchor(scope: string, path: string): string {
  const slug = (value: string) => value.replace(/[^a-zA-Z0-9_-]+/g, "-");
  return `file-${slug(scope)}-${slug(path)}`;
}

/** The after-side path a `FileDiff` reads under, regardless of its shape. */
export function afterPathOf(file: FileDiff): string {
  return "path" in file ? file.path : file.newPath;
}

/** The path a file's header shows and its comments are filed under:
 *  `old → new` for a rename or a copy. */
export function shownPathOf(file: FileDiff): string {
  return "path" in file ? file.path : `${file.oldPath} → ${file.newPath}`;
}

function countPatch(patch: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const hunk of readPatch(patch).hunks) {
    for (const line of hunk.lines) {
      if (line.kind === "added") added++;
      else if (line.kind === "removed") removed++;
    }
  }
  return { added, removed };
}

/** One `FileDiff` read into a `ChangedFile`, its comments narrowed to the
 *  ones open against it, under the same path the diff files them. */
export function changedFile(
  file: FileDiff,
  anchor: string,
  comments: RowComment[],
): ChangedFile {
  const path = afterPathOf(file);
  const { added, removed } = countPatch(file.patch);
  return {
    anchor,
    path,
    from: "path" in file ? null : file.oldPath,
    status: file.status,
    added,
    removed,
    binary: file.binary,
    openComments: comments.filter(
      (comment) => comment.path === shownPathOf(file) && !comment.resolved,
    ).length,
  };
}

/** A row's files, each read into a `ChangedFile` under one scope. */
export function changedFilesOf(
  files: FileDiff[],
  scope: string,
  comments: RowComment[],
): ChangedFile[] {
  return files.map((file) =>
    changedFile(file, fileAnchor(scope, afterPathOf(file)), comments),
  );
}
```

The backend sends files in path order, so a tree built without sorting
already reads in that order, depth first. That is also the order the diff
itself draws its files in, so a tree's leaves, the diff's own order, and
the order `Prev`/`Next` step through agree by construction rather than by a
sort the three would otherwise have to share.

`fileTree` builds the un-folded tree first, one folder per path segment,
keyed in a `Map` so each folder keeps the order its children first
appeared in. Folding is a second pass: a folder whose only child is another
folder is the same row as that child, chained under one name, so it
collapses; a folder whose only child is a file is not, because a file is
never folded into anything.

```ts
//| id: frontend-view-changed-files

interface MutableFolder {
  kind: "folder";
  name: string;
  children: Map<string, MutableNode>;
}

type MutableNode =
  | MutableFolder
  | { kind: "file"; name: string; file: ChangedFile };

/** `files` folded into a tree, children kept in first-appearance order. */
export function fileTree(files: ChangedFile[]): TreeNode[] {
  const root: MutableFolder = { kind: "folder", name: "", children: new Map() };

  for (const file of files) {
    const parts = file.path.split("/");
    let node = root;
    for (const part of parts.slice(0, -1)) {
      const existing = node.children.get(part);
      if (existing !== undefined && existing.kind === "folder") {
        node = existing;
        continue;
      }
      const folder: MutableFolder = {
        kind: "folder",
        name: part,
        children: new Map(),
      };
      node.children.set(part, folder);
      node = folder;
    }
    const name = parts.at(-1) as string;
    node.children.set(name, { kind: "file", name, file });
  }

  return [...root.children.values()].map(fold);
}

/** Chains a folder into its only child while that child is itself a
 *  folder with nothing beside it, then folds each of the result's own
 *  children the same way. */
function fold(node: MutableNode): TreeNode {
  if (node.kind === "file") return node;

  let folder = node;
  while (folder.children.size === 1) {
    const [only] = folder.children.values();
    if (only === undefined || only.kind !== "folder") break;
    folder = {
      kind: "folder",
      name: `${folder.name}/${only.name}`,
      children: only.children,
    };
  }

  return {
    kind: "folder",
    name: folder.name,
    children: [...folder.children.values()].map(fold),
  };
}
```

### Test

```ts
//| id: frontend-view-changed-files-test
//| file: src/frontend/views/changedFiles.test.ts
import { describe, expect, test } from "bun:test";
import type { FileDiff } from "../api";
import type { RowComment } from "../state/review";
import {
  type ChangedFile,
  changedFile,
  changedFilesOf,
  fileAnchor,
  fileTree,
  shownPathOf,
} from "./changedFiles";

const PATCH = ["@@ -1,2 +1,3 @@", " keep", "-old", "+new", "+another"].join(
  "\n",
);

function added(path: string, patch = PATCH): FileDiff {
  return {
    status: "added",
    path,
    binary: false,
    oldBlob: null,
    newBlob: "b",
    patch,
    structural: { kind: "unavailable", reason: "test fixture" },
  };
}

function renamed(oldPath: string, newPath: string): FileDiff {
  return {
    status: "renamed",
    oldPath,
    newPath,
    binary: false,
    oldBlob: "a",
    newBlob: "b",
    patch: PATCH,
    structural: { kind: "unavailable", reason: "test fixture" },
  };
}

function comment(path: string, resolved: boolean): RowComment {
  return {
    id: `${path}:${String(resolved)}`,
    reviewKey: "row",
    path,
    line: 1,
    commitId: "c",
    body: "hi",
    resolved,
    createdAt: "2024-01-01T00:00:00Z",
    stale: false,
  };
}

describe("fileTree", () => {
  test("folds a chain of single-folder directories into one row", () => {
    // arrange
    const files = changedFilesOf(
      [added("src/frontend/views/a.ts"), added("src/frontend/views/b.ts")],
      "row",
      [],
    );

    // act
    const tree = fileTree(files);

    // assert
    expect(tree).toEqual([
      {
        kind: "folder",
        name: "src/frontend/views",
        children: [
          { kind: "file", name: "a.ts", file: files[0] as ChangedFile },
          { kind: "file", name: "b.ts", file: files[1] as ChangedFile },
        ],
      },
    ]);
  });

  test("does not fold a folder whose one child is a file", () => {
    // arrange
    const files = changedFilesOf([added("a/b.ts")], "row", []);

    // act
    const tree = fileTree(files);

    // assert
    expect(tree).toEqual([
      {
        kind: "folder",
        name: "a",
        children: [
          { kind: "file", name: "b.ts", file: files[0] as ChangedFile },
        ],
      },
    ]);
  });

  test("keeps children in first-appearance order, not sorted", () => {
    // arrange
    const files = changedFilesOf(
      [added("z.ts"), added("a/two.ts"), added("a/one.ts")],
      "row",
      [],
    );

    // act
    const tree = fileTree(files);

    // assert
    expect(tree.map((node) => node.name)).toEqual(["z.ts", "a"]);
    const folder = tree[1];
    expect(folder?.kind).toBe("folder");
    expect(
      folder?.kind === "folder" ? folder.children.map((c) => c.name) : [],
    ).toEqual(["two.ts", "one.ts"]);
  });

  test("keys a renamed file by its new path", () => {
    // arrange
    // act
    const file = changedFile(
      renamed("old/name.ts", "new/name.ts"),
      "anchor",
      [],
    );

    // assert
    expect(file.path).toBe("new/name.ts");
    expect(file.from).toBe("old/name.ts");
  });

  test("counts added and removed lines from the patch's hunks", () => {
    // arrange
    // act
    const file = changedFile(added("a.ts"), "anchor", []);

    // assert
    expect(file.added).toBe(2);
    expect(file.removed).toBe(1);
  });

  test("counts only unresolved comments on the file's own path", () => {
    // arrange
    const comments = [
      comment("a.ts", false),
      comment("a.ts", true),
      comment("b.ts", false),
    ];

    // act
    const file = changedFile(added("a.ts"), "anchor", comments);

    // assert
    expect(file.openComments).toBe(1);
  });

  test("counts a renamed file's comments under the path its header shows", () => {
    // arrange
    const file = renamed("old.ts", "new.ts");

    // act
    const changed = changedFile(file, "anchor", [
      comment(shownPathOf(file), false),
    ]);

    // assert
    expect(changed.openComments).toBe(1);
  });
});

describe("fileAnchor", () => {
  test("gives the same file two different ids under two scopes", () => {
    // arrange
    // act
    // assert
    expect(fileAnchor("row-1", "a.ts")).not.toBe(fileAnchor("row-2", "a.ts"));
  });
});

describe("shownPathOf", () => {
  test("shows a rename as both of its paths", () => {
    // arrange
    // act
    // assert
    expect(shownPathOf(added("a.ts"))).toBe("a.ts");
    expect(shownPathOf(renamed("old.ts", "new.ts"))).toBe("old.ts → new.ts");
  });
});
```
