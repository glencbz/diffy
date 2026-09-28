// ~/~ begin <<docs/architecture/backend/review-store.md#backend-review-store-test>>[init]

import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ReviewCommand } from "../../frontend/model/review";
import { openReviewStore, reviewStorePath, watchReview } from "./store";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "diffy-review-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const seen: ReviewCommand = {
  kind: "set-seen",
  comparison: { reviewKey: "change:a", fromCommitId: "a1", toCommitId: "a2" },
  seen: true,
  at: "2026-09-28T09:00:00.000Z",
};

describe("openReviewStore", () => {
  test("reads an empty document at revision 0 from a new file", () => {
    // arrange
    const store = openReviewStore(join(dir, "r.sqlite"));

    // act
    // assert
    expect(store.read()).toEqual({
      revision: 0,
      document: { marks: [], comments: [], viewed: [], reviewed: [] },
    });
  });

  test("applies a command, counts the write, and keeps it on disk", () => {
    // arrange
    const path = join(dir, "r.sqlite");

    // act
    const answer = openReviewStore(path).apply(seen);

    // assert
    expect(answer.revision).toBe(1);
    expect(answer.document.marks).toHaveLength(1);
    expect(openReviewStore(path).read()).toEqual(answer);
  });

  test("leaves the document of one application when a command lands twice", () => {
    // arrange
    const store = openReviewStore(join(dir, "r.sqlite"));

    // act
    const once = store.apply(seen);
    const twice = store.apply(seen);

    // assert
    expect(twice.document).toEqual(once.document);
    expect(twice.revision).toBe(2);
  });

  test("builds on what another store on the same file wrote", () => {
    // arrange
    const path = join(dir, "r.sqlite");
    const one = openReviewStore(path);
    const other = openReviewStore(path);
    one.apply(seen);

    // act
    const answer = other.apply({
      kind: "set-viewed",
      reviewKey: "change:a",
      file: { path: "f.ts", oldBlob: "b1", newBlob: "b2" },
      viewed: true,
      at: "2026-09-28T09:01:00.000Z",
    });

    // assert
    expect(answer.revision).toBe(2);
    expect(answer.document.marks).toHaveLength(1);
    expect(answer.document.viewed).toHaveLength(1);
  });

  test("refuses a stored document it cannot read rather than replacing it", () => {
    // arrange
    const path = join(dir, "r.sqlite");
    openReviewStore(path).apply(seen);
    new Database(path).run("UPDATE review SET document = '{\"marks\":7}'");
    const store = openReviewStore(path);

    // act
    // assert
    expect(() => store.read()).toThrow();
    expect(() => store.apply(seen)).toThrow();
    expect(
      new Database(path).query("SELECT document FROM review").get(),
    ).toEqual({ document: '{"marks":7}' });
  });
});

describe("reviewStorePath", () => {
  test("names a file under the data directory after the repository", async () => {
    // arrange
    // act
    const path = await reviewStorePath({ XDG_DATA_HOME: dir });

    // assert
    expect(path.startsWith(join(dir, "diffy"))).toBe(true);
    expect(path).toMatch(/-[0-9a-f]{16}\.sqlite$/);
    expect(await reviewStorePath({ XDG_DATA_HOME: dir })).toBe(path);
  });
});

describe("watchReview", () => {
  test("hears a write another store made to the same file", async () => {
    // arrange
    const path = join(dir, "r.sqlite");
    const watched = openReviewStore(path);
    const heard: number[] = [];
    const stop = watchReview(watched, (revision) => heard.push(revision), 10);

    // act
    openReviewStore(path).apply(seen);
    await Bun.sleep(60);
    stop();

    // assert
    expect(heard).toEqual([1]);
  });
});
// ~/~ end
