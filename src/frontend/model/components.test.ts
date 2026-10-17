// ~/~ begin <<docs/architecture/frontend/components.md#frontend-model-components-test>>[init]
import { describe, expect, test } from "bun:test";
import {
  type Component,
  type ComponentMap,
  componentsTo,
  counterpartFate,
  DEFAULT_KINDS,
  drawnPlaces,
  fileShares,
  interdiffFate,
  kindColours,
  marked,
  mentionedIn,
  placeAt,
  placeKey,
  placeVersion,
  referencesIn,
  rowTrees,
  runStarts,
  sameFold,
  sameRun,
  withComponents,
  withKind,
  wordAdded,
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
    groups: [],
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

describe("a vocabulary", () => {
  test("keeps a redefined kind where it stood, and adds a new one last", () => {
    // arrange
    const kinds = [
      { name: "model", advice: "" },
      { name: "view", advice: "" },
    ];

    // act
    const redefined = withKind(kinds, { name: "model", advice: "data" });
    const added = withKind(kinds, { name: "controller", advice: "" });

    // assert
    expect(redefined.map((kind) => kind.advice)).toEqual(["data", ""]);
    expect(added.map((kind) => kind.name)).toEqual([
      "model",
      "view",
      "controller",
    ]);
  });

  test("moves a kind before the one it is placed before", () => {
    // arrange
    const kinds = [
      { name: "model", advice: "" },
      { name: "view", advice: "" },
      { name: "controller", advice: "" },
    ];

    // act
    const moved = withKind(kinds, { name: "controller", advice: "" }, "model");
    const added = withKind(kinds, { name: "route", advice: "" }, "view");

    // assert
    expect(moved.map((kind) => kind.name)).toEqual([
      "controller",
      "model",
      "view",
    ]);
    expect(added.map((kind) => kind.name)).toEqual([
      "model",
      "route",
      "view",
      "controller",
    ]);
  });

  test("gives the first seven kinds a lane's colour each, and leaves the rest grey", () => {
    // arrange
    // act
    const rules = kindColours(DEFAULT_KINDS).split("\n");

    // assert
    expect(rules).toHaveLength(7);
    expect(rules[0]).toBe(
      ".components-kind--schema { --component: var(--graph-lane-0); }",
    );
    expect(rules.join("\n")).not.toContain("wiring");
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

describe("folds", () => {
  test("folds one place of a commit's own diff, and a component's share of an interdiff", () => {
    // arrange
    const own = rowTrees({ commit: { commitId: "c2" }, was: null });
    const between = rowTrees({
      commit: { commitId: "c2" },
      was: { commitId: "c1" },
    });
    const old = { component: RENAME, place: 0 };
    const renamed = { component: RENAME, place: 1 };

    // act
    const apart = sameFold(own, old, renamed);
    const together = sameFold(between, { component: OLDER, place: 0 }, old);

    // assert
    expect(apart).toBe(false);
    expect(together).toBe(true);
  });

  test("marks a place by its own lines, whatever else the file changes", () => {
    // arrange
    const trees = rowTrees({ commit: { commitId: "c2" }, was: null });
    const four = { component: FOUR, place: 0 };
    const other = PATCH.replace("+TWO", "+Two");

    // act
    const before = placeVersion(ALL, trees, file(), four);
    const after = placeVersion(ALL, trees, file(other), four);
    const changed = placeVersion(
      ALL,
      trees,
      file(PATCH.replace("+FOUR", "+Four")),
      four,
    );

    // assert
    expect(after).toEqual(before);
    expect(changed.lines).not.toBe(before.lines);
    expect(before).toMatchObject({ componentId: "four", path: "a.ts" });
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

describe("finding where a word is added", () => {
  const ADDS = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -0,0 +1,5 @@
+import { Peek } from "./peek";
+const a = 1;
+export function Peek() {}
+const PeekAll = 2;
+use(Peek);
`;
  const trees = rowTrees({ commit: { commitId: "c1" }, was: null });
  const own = (start: number, end: number): Component => ({
    ...component("peek"),
    places: [{ path: "a.ts", side: "after", start, end, about: "" }],
  });

  test("lands on the declaration rather than the import before it", () => {
    // act
    const found = wordAdded("Peek", "peek", [own(1, 5)], trees, [file(ADDS)]);

    // assert
    expect(found?.at.line).toBe(3);
    expect(found?.declares).toBe(true);
  });

  test("falls back to the first line naming it, in its component only", () => {
    // arrange
    const other = { ...component("other"), places: own(1, 3).places };

    // act
    const named = wordAdded("Peek", "peek", [own(4, 5), other], trees, [
      file(ADDS),
    ]);
    const missing = wordAdded("Gone", "peek", [own(1, 5)], trees, [file(ADDS)]);

    // assert
    expect(named).toEqual({
      at: { ref: { component: own(4, 5), place: 0 }, path: "a.ts", line: 5 },
      declares: false,
    });
    expect(missing).toBeNull();
  });
});

describe("finding what uses a component", () => {
  const USES = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1,2 +1,5 @@
 import { Reply } from "./reply";
+export const Reply = z.object({});
+const replies = z.array(Reply);
+use(Reply, Reply);
 ReplyList();
`;
  const trees = rowTrees({ commit: { commitId: "c1" }, was: null });
  const at = (id: string, start: number, commitId = "c1"): Component => ({
    ...component(id, commitId),
    words: id === "field" ? ["replies"] : ["Reply"],
    places: [{ path: "a.ts", side: "after", start, about: "" }],
  });

  test("finds each line naming it outside its own places, once a line", () => {
    // arrange
    const reply = at("reply", 2);
    const field = at("field", 3);

    // act
    const found = referencesIn([reply, field], trees, [file(USES)]);

    // assert
    expect(
      found.map((each) => [each.line, each.from?.component.id, each.added]),
    ).toEqual([
      [1, undefined, false],
      [3, "field", true],
      [4, undefined, true],
    ]);
    expect(found.every((each) => each.to === reply)).toBe(true);
  });

  test("names the row's own version of a component two maps give", () => {
    // arrange
    const older = at("reply", 9, "c0");
    const newer = at("reply", 2);

    // act
    const found = referencesIn([older, newer], trees, [file(USES)]);

    // assert
    expect(found.every((each) => each.to === newer)).toBe(true);
  });
});
// ~/~ end
