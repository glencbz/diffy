// ~/~ begin <<docs/architecture/frontend/components.md#frontend-model-components-test>>[init]
import { describe, expect, test } from "bun:test";
import {
  type Component,
  type ComponentMap,
  componentsTo,
  counterpartFate,
  drawnPlaces,
  fileShares,
  interdiffFate,
  marked,
  mentionedIn,
  placeAt,
  placeKey,
  rowTrees,
  runStarts,
  sameRun,
  withComponents,
} from "./components";
import type { FileDiff } from "./diff";

function component(id: string, commitId = "c1"): Component {
  return {
    commitId,
    id,
    kind: "command",
    name: id,
    role: "implements",
    gist: "",
    words: [],
    mentions: [],
    places: [{ path: "a.ts", side: "after", start: 1, about: "" }],
  };
}

function map(version: string, ids: string[]): ComponentMap {
  return {
    series: "local:r",
    version,
    author: "claude",
    writtenAt: "t",
    components: ids.map((id) => component(id)),
  };
}

describe("component maps", () => {
  test("keeps one map to each version, the newest written", () => {
    // arrange
    const maps = withComponents([map("1", ["a"])], map("2", ["a"]));

    // act
    const rewritten = withComponents(maps, map("1", ["b"]));

    // assert
    expect(rewritten).toHaveLength(2);
    expect(componentsTo(rewritten, "local:r", "1")?.components[0]?.id).toBe(
      "b",
    );
    expect(componentsTo(rewritten, "local:r", "3")).toBeUndefined();
  });
});

const PATCH = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1,4 +1,4 @@
 one
-two
+TWO
 three
-four
+FOUR
`;

function file(patch = PATCH): FileDiff {
  return {
    status: "modified",
    path: "a.ts",
    binary: false,
    oldBlob: "1111111",
    newBlob: "2222222",
    patch,
    structural: { kind: "unavailable", reason: "test" },
  };
}

/** `c2` renames two in one component and four in another; `c1` is the
 *  version before it, which only had the first. */
const RENAME: Component = {
  ...component("rename", "c2"),
  places: [
    { path: "a.ts", side: "before", start: 2, about: "old" },
    { path: "a.ts", side: "after", start: 2, about: "new" },
  ],
};
const FOUR: Component = {
  ...component("four", "c2"),
  places: [{ path: "a.ts", side: "after", start: 4, about: "" }],
};
const OLDER: Component = {
  ...component("rename", "c1"),
  places: [{ path: "a.ts", side: "after", start: 2, about: "" }],
};
const ALL = [RENAME, FOUR, OLDER];

describe("reading a row", () => {
  test("finds a line's place in the tree each side of a row counts", () => {
    // arrange
    const own = rowTrees({ commit: { commitId: "c2" }, was: null });
    const between = rowTrees({
      commit: { commitId: "c2" },
      was: { commitId: "c1" },
    });

    // act
    const removed = placeAt(ALL, own.before, "a.ts", 2);
    const older = placeAt(ALL, between.before, "a.ts", 2);

    // assert
    expect(removed).toEqual({ component: RENAME, place: 0 });
    expect(older).toEqual({ component: OLDER, place: 0 });
    expect(placeAt(ALL, own.after, "a.ts", 3)).toBeNull();
  });

  test("lists each place a diff changes once, in the order it draws them", () => {
    // arrange
    const trees = rowTrees({ commit: { commitId: "c2" }, was: null });

    // act
    const drawn = drawnPlaces(ALL, trees, [file()]);

    // assert
    expect(
      drawn.map(({ ref, added, removed }) => [placeKey(ref), added, removed]),
    ).toEqual([
      ["c2:rename/0", 0, 1],
      ["c2:rename/1", 1, 0],
      ["c2:four/0", 1, 0],
    ]);
  });

  test("shares a file's changed lines out by component, unowned last", () => {
    // arrange
    const trees = rowTrees({ commit: { commitId: "c2" }, was: null });

    // act
    const shares = fileShares([RENAME, OLDER], trees, file());

    // assert
    expect(shares.map((share) => [share.id, share.lines])).toEqual([
      ["rename", 2],
      [null, 2],
    ]);
  });
});

describe("runs", () => {
  test("reads an interdiff's two versions of one component as one run", () => {
    // arrange
    const older = { component: OLDER, place: 0 };
    const newer = { component: RENAME, place: 1 };

    // act
    const starts = runStarts([
      { ref: older, path: "a.ts", added: 0, removed: 1 },
      { ref: newer, path: "a.ts", added: 1, removed: 0 },
      {
        ref: { component: FOUR, place: 0 },
        path: "a.ts",
        added: 1,
        removed: 0,
      },
    ]);

    // assert
    expect(sameRun(older, newer)).toBe(true);
    expect(sameRun(newer, { component: RENAME, place: 0 })).toBe(false);
    expect(starts.map((each) => each.ref.component.id)).toEqual([
      "rename",
      "four",
    ]);
  });
});

describe("fates", () => {
  test("calls a component new or gone only when both versions have maps", () => {
    // arrange
    const four = { component: FOUR, place: 0 };

    // act
    const mapped = interdiffFate(four, [OLDER], [RENAME, FOUR]);
    const unmapped = interdiffFate(four, [], [RENAME, FOUR]);
    const gone = interdiffFate({ component: OLDER, place: 0 }, [OLDER], [FOUR]);

    // assert
    expect([mapped, unmapped, gone]).toEqual(["new", "changed", "removed"]);
  });

  test("holds a place against its counterpart by the lines the comparison touches", () => {
    // arrange
    const renamed = { component: RENAME, place: 1 };
    const between = file(`diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -2,1 +2,1 @@
-two
+TWO
`);

    // act
    const since = counterpartFate(renamed, "a.ts", {
      direction: "since",
      components: [OLDER],
      files: [between],
    });
    const untouched = counterpartFate(renamed, "a.ts", {
      direction: "since",
      components: [OLDER],
      files: [],
    });
    const fresh = counterpartFate({ component: FOUR, place: 0 }, "a.ts", {
      direction: "since",
      components: [OLDER],
      files: [between],
    });

    // assert
    expect([since, untouched, fresh]).toEqual(["changed", "unchanged", "new"]);
  });
});

describe("marking text", () => {
  test("finds a word only whole, and a phrase anywhere", () => {
    // arrange
    const marks = new Map([
      ["Reply", 1],
      ["add-reply", 2],
    ]);

    // act
    const words = marked("replyToComment(Reply, add-reply)", marks, true);
    const phrases = marked("a Replyish thing", marks, false);

    // assert
    expect(words.filter((run) => run.mark !== null)).toEqual([
      { text: "Reply", mark: 1 },
      { text: "add-reply", mark: 2 },
    ]);
    expect(phrases.map((run) => run.text)).toEqual([
      "a ",
      "Reply",
      "ish thing",
    ]);
  });

  test("reads a mention across the message's line breaks", () => {
    // arrange
    const quoted = { ...RENAME, mentions: ["make two louder"] };

    // act
    const found = mentionedIn("louder\n\nWe make two\nlouder here.", quoted);

    // assert
    expect(found).toBe(true);
  });
});
// ~/~ end
