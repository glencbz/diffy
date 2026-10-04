// ~/~ begin <<docs/architecture/frontend/local-reviews.md#frontend-model-revset-test>>[init]
import { describe, expect, test } from "bun:test";
import type { CommitRef, LogEntry } from "./history";
import { reviewNameFor, revsetFor } from "./revset";

function commit(
  id: string,
  parents: string[],
  bookmarks: string[] = [],
): LogEntry {
  return {
    commitId: `${id}-commit`,
    changeId: `${id}-change-id`,
    description: id,
    parents: parents.map((parent) => `${parent}-commit`),
    author: "someone@example.com",
    timestamp: "2026-01-01T00:00:00Z",
    refs: bookmarks.map((name): CommitRef => ({ kind: "bookmark", name })),
    markers: [],
  };
}

// c <- b <- a <- main <- root, and a side branch s off main
const LOG = [
  commit("c", ["b"], ["feature"]),
  commit("b", ["a"]),
  commit("s", ["main"]),
  commit("a", ["main"]),
  commit("main", ["root"], ["main"]),
  commit("root", []),
];
const ids = (...names: string[]) => names.map((name) => `${name}-commit`);
const TRUNK = "main-commit";

describe("revsetFor", () => {
  test("names a stack on trunk by its bookmark", () => {
    expect(revsetFor(LOG, ids("c", "b", "a"), TRUNK)).toBe(
      'trunk().."feature"',
    );
  });

  test("names a run that stops short of trunk by its ends", () => {
    expect(revsetFor(LOG, ids("c", "b"), TRUNK)).toBe('b-change-id::"feature"');
  });

  test("names one commit on its own", () => {
    expect(revsetFor(LOG, ids("b"), TRUNK)).toBe("b-change-id");
  });

  test("lists commits that are not one run", () => {
    expect(revsetFor(LOG, ids("c", "s"), TRUNK)).toBe(
      '"feature" | s-change-id',
    );
  });

  test("reads trunk as the server named it, not off a bookmark", () => {
    expect(revsetFor(LOG, ids("a", "main"), "root-commit")).toBe(
      "trunk()..a-change-id",
    );
    expect(revsetFor(LOG, ids("a"), "root-commit")).toBe("a-change-id");
  });

  test("names the run by its ends while trunk is unknown", () => {
    expect(revsetFor(LOG, ids("c", "b", "a"), null)).toBe(
      'a-change-id::"feature"',
    );
  });

  test("names nothing for no ticks", () => {
    expect(revsetFor(LOG, [], TRUNK)).toBe("");
  });
});

describe("reviewNameFor", () => {
  test("takes the one head's bookmark", () => {
    expect(reviewNameFor(LOG, ids("c", "b"))).toBe("feature");
  });

  test("falls back to the head's change id", () => {
    expect(reviewNameFor(LOG, ids("b", "a"))).toBe("b-change");
  });

  test("leaves a series with two heads unnamed", () => {
    expect(reviewNameFor(LOG, ids("c", "s"))).toBe("");
  });
});
// ~/~ end
