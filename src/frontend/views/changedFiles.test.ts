// ~/~ begin <<docs/architecture/frontend/file-tree.md#frontend-view-changed-files-test>>[init]
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
    kind: "line",
    path,
    side: "after",
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

  test("counts a comment on the whole file but not one on the comparison", () => {
    // arrange
    const written = {
      reviewKey: "row",
      commitId: "c",
      body: "hi",
      resolved: false,
      createdAt: "2024-01-01T00:00:00Z",
      stale: false,
    };

    // act
    const file = changedFile(added("a.ts"), "anchor", [
      { ...written, id: "file", kind: "file", path: "a.ts" },
      { ...written, id: "comparison", kind: "comparison" },
    ]);

    // assert
    expect(file.openComments).toBe(1);
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
// ~/~ end
