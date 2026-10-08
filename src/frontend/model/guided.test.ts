// ~/~ begin <<docs/architecture/frontend/guide.md#frontend-model-guided-test>>[init]
import { describe, expect, test } from "bun:test";
import type { FileDiff } from "./diff";
import type { GuideIdea } from "./guide";
import { coverOf, covers, guidedCommit, ideaOf } from "./guided";

function diff(path: string, patch: string): FileDiff {
  return {
    status: "modified",
    path,
    binary: false,
    oldBlob: "a",
    newBlob: "b",
    patch,
    structural: { kind: "unavailable", reason: "test" },
  };
}

// Line 2 is rewritten and line 21 added, in a file 23 lines long.
const STORE = diff(
  "store.ts",
  `--- a/store.ts
+++ b/store.ts
@@ -1,3 +1,3 @@
 one
-two
+TWO
 three
@@ -20,2 +20,3 @@
 twenty
+twenty-one
 twenty-two
`,
);

const API = diff(
  "api.ts",
  `--- a/api.ts
+++ b/api.ts
@@ -5,2 +5,3 @@
 five
+  six
 seven
`,
);

function idea(title: string, ...stops: GuideIdea["stops"]): GuideIdea {
  return { commitId: "c1", title, note: "", stops };
}

const after = (line: number, beforeLine: number | null = null) => ({
  anchor: { side: "after" as const, line },
  beforeLine,
});
const before = (line: number) => ({
  anchor: { side: "before" as const, line },
  beforeLine: line,
});

describe("coverOf", () => {
  test("takes in the lines a stop's first line replaced", () => {
    // arrange
    const commit = guidedCommit(
      "c1",
      [STORE],
      [idea("Rename", { path: "store.ts", side: "after", start: 2, note: "" })],
      { beforeSide: true },
    );
    const cover = commit.notes[0]?.cover;
    if (cover == null) throw new Error("no cover");

    // act
    // assert
    expect(covers(cover, before(2))).toBe(true);
    expect(covers(cover, after(2))).toBe(true);
    expect(covers(cover, after(3, 3))).toBe(false);
  });

  test("covers every line of a file's hunks for a stop with no lines", () => {
    // arrange
    // act
    const cover = coverOf({ path: "store.ts", side: "after", note: "" }, []);

    // assert
    expect(covers(cover, after(1, 1))).toBe(false);
  });
});

describe("guidedCommit", () => {
  test("colours lines by the first idea on them, and places notes", () => {
    // arrange
    // act
    const commit = guidedCommit(
      "c1",
      [API, STORE],
      [
        idea("Rename", {
          path: "store.ts",
          side: "after",
          start: 2,
          note: "a",
        }),
        idea(
          "Everything",
          { path: "store.ts", side: "after", note: "b" },
          { side: "after", note: "the message" },
        ),
      ],
      { beforeSide: true },
    );

    // assert
    expect(commit.files.map((file) => file.path)).toEqual([
      "api.ts",
      "store.ts",
    ]);
    expect(commit.ideas.map((each) => each.colour)).toEqual(["blue", "amber"]);
    expect(ideaOf(commit, "store.ts", after(1, 1))).toBe(1);
    expect(ideaOf(commit, "store.ts", before(2))).toBe(0);
    expect(ideaOf(commit, "store.ts", after(2))).toBe(0);
    expect(ideaOf(commit, "store.ts", after(10, 10))).toBeNull();
    expect(ideaOf(commit, "store.ts", after(21))).toBe(1);
    expect(ideaOf(commit, "api.ts", after(6))).toBeNull();
    expect(commit.files[1]?.owners).toEqual([0, 0, 1]);
    expect(
      commit.notes.map(({ key, path, anchor }) => ({ key, path, anchor })),
    ).toEqual([
      { key: "c1:0.0", path: "store.ts", anchor: { side: "before", line: 2 } },
      { key: "c1:1.0", path: "store.ts", anchor: { side: "after", line: 2 } },
      { key: "c1:1.1", path: null, anchor: null },
    ]);
  });

  test("drops a stop on a file the commit does not have", () => {
    // arrange
    // act
    const commit = guidedCommit(
      "c1",
      [STORE],
      [idea("Lost", { path: "gone.ts", side: "after", note: "a" })],
      { beforeSide: true },
    );

    // assert
    expect(commit.notes).toEqual([]);
    expect(commit.files[0]?.owners.every((owner) => owner === null)).toBe(true);
  });

  test("leaves before-side lines alone against an older version", () => {
    // arrange
    // act
    const commit = guidedCommit(
      "c1",
      [STORE],
      [idea("Old", { path: "store.ts", side: "before", start: 2, note: "a" })],
      { beforeSide: false },
    );

    // assert
    expect(ideaOf(commit, "store.ts", before(2))).toBeNull();
    expect(commit.notes.map((note) => note.anchor)).toEqual([null]);
  });
});
// ~/~ end
