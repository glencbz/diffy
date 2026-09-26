// ~/~ begin <<docs/architecture/frontend/pull-requests.md#frontend-persistence-last-reviewed-test>>[init]
import { beforeEach, describe, expect, test } from "bun:test";
import { GitOid } from "../api";
import { lastReviewedRepository } from "./lastReviewed";

function memoryStorage(): Pick<Storage, "getItem" | "setItem"> {
  const store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
  };
}

beforeEach(() => {
  globalThis.localStorage = memoryStorage() as unknown as Storage;
});

function oid(ch: string): GitOid {
  return GitOid.parse(ch.repeat(40));
}

describe("lastReviewedRepository", () => {
  test("round-trips a head through save, per pull request", () => {
    // arrange
    lastReviewedRepository("o/r", 7).save({ head: oid("a") });
    lastReviewedRepository("o/r", 8).save({ head: oid("b") });

    // act
    // assert
    expect(lastReviewedRepository("o/r", 7).load()).toEqual({ head: oid("a") });
    expect(lastReviewedRepository("o/r", 8).load()).toEqual({ head: oid("b") });
    expect(lastReviewedRepository("o/other", 7).load()).toBeNull();
  });

  test("reads a value that does not parse as no mark, and keeps the others", () => {
    // arrange
    lastReviewedRepository("o/r", 8).save({ head: oid("b") });
    localStorage.setItem("diffy.last-reviewed.v1:o/r#9", '{"head":"abc"}');
    localStorage.setItem("diffy.session.v1", '{"marks":[],"comments":[]}');

    // act
    // assert
    expect(lastReviewedRepository("o/r", 9).load()).toBeNull();
    expect(lastReviewedRepository("o/r", 8).load()).toEqual({ head: oid("b") });
    expect(localStorage.getItem("diffy.session.v1")).toBe(
      '{"marks":[],"comments":[]}',
    );
  });
});
// ~/~ end
