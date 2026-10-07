// ~/~ begin <<docs/architecture/frontend/tour.md#src/frontend/model/tour.test.ts>>[init]
import { describe, expect, test } from "bun:test";
import type { FileDiff } from "./diff";
import type { Guide } from "./guide";
import {
  buildTour,
  type CommitInput,
  fileOrder,
  stopSpan,
  tourFile,
} from "./tour";

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
+export function applyCommand(doc) {
 three
@@ -20,2 +20,3 @@
 twenty
+twenty-one
 twenty-two
`,
);

const SERVER = diff(
  "server.ts",
  `--- a/server.ts
+++ b/server.ts
@@ -5,2 +5,3 @@
 five
+  return applyCommand(read());
 six
`,
);

function commit(id: string, ...files: FileDiff[]): CommitInput {
  return {
    commitId: id,
    description: `${id}: subject\n\nbody`,
    files: files.map((file) => tourFile(file, null)),
  };
}

const GUIDE: Guide = {
  series: "local:x",
  version: "1",
  author: "claude",
  writtenAt: "t",
  ideas: [
    {
      id: "apply",
      commitId: "c1",
      title: "One function applies them",
      note: "",
      stops: [
        { path: "store.ts", side: "after", start: 2, end: 2, note: "here" },
      ],
    },
    {
      id: "serve",
      commitId: "c2",
      title: "The server applies too",
      note: "",
      stops: [{ side: "after", note: "the message" }],
    },
  ],
  links: [{ from: "serve", to: "apply", say: "the same function" }],
};

describe("tourFile", () => {
  test("puts the unchanged lines between hunks back, and the tail once its length is known", () => {
    // arrange
    // act
    const rows = tourFile(STORE, 23).rows;

    // assert
    expect(rows.map((row) => row.kind[0]).join("")).toBe(
      `crac${"c".repeat(16)}cacc`,
    );
    expect(rows.at(-1)).toEqual({
      kind: "context",
      old: 22,
      new: 23,
      code: null,
    });
    expect(tourFile(STORE, null).rows).toHaveLength(23);
  });

  test("reads a stop's lines with the lines its first line replaced", () => {
    // arrange
    const file = tourFile(STORE, 23);

    // act
    // assert
    expect(
      stopSpan(file, { side: "after", start: 2, end: 2, note: "" }),
    ).toEqual([1, 2]);
    expect(stopSpan(file, { side: "before", start: 2, note: "" })).toEqual([
      1, 1,
    ]);
    expect(stopSpan(file, { side: "after", start: 90, note: "" })).toBeNull();
  });
});

describe("buildTour", () => {
  test("reads the guide's ideas first and gathers what it left out by file", () => {
    // arrange
    // act
    const tour = buildTour([commit("c1", STORE), commit("c2", SERVER)], GUIDE);

    // assert
    const [first, second] = tour.commits;
    expect(
      first?.ideas.map((idea) => [idea.title, idea.guided, idea.size]),
    ).toEqual([
      ["One function applies them", true, 2],
      ["store.ts", false, 1],
    ]);
    expect(second?.ideas.map((idea) => idea.title)).toEqual([
      "The server applies too",
      "server.ts",
    ]);
    if (second === undefined) throw new Error("no second commit");
    expect(fileOrder(second).map((card) => card.kind)).toEqual([
      "message",
      "file",
    ]);
  });

  test("reads a series with no guide file by file", () => {
    // arrange
    // act
    const tour = buildTour([commit("c1", STORE)], undefined);

    // assert
    expect(tour.commits[0]?.ideas).toEqual([
      expect.objectContaining({ id: "c1:store.ts", guided: false }),
    ]);
    expect(tour.commits[0]?.ideas[0]?.cards[0]).toMatchObject({
      spans: [
        [0, 3],
        [20, 22],
      ],
    });
  });
});
// ~/~ end
