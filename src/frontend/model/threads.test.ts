// ~/~ begin <<docs/architecture/frontend/threads.md#frontend-model-threads-test>>[init]
import { describe, expect, test } from "bun:test";
import type { FileDiff } from "./diff";
import { type GitCommit, GitOid } from "./history";
import type { SeriesPlace } from "./place";
import type { Comment, RowComment } from "./review";
import {
  byVersion,
  type Drawn,
  drawnThreads,
  type SeriesThread,
  seriesThreads,
  threadPlace,
  threadsIn,
  type VersionCommits,
} from "./threads";

function oid(seed: string): GitOid {
  return GitOid.parse(seed.repeat(40).slice(0, 40));
}

function commit(seed: string, changeId: string | null): GitCommit {
  return {
    commitId: oid(seed),
    parents: [],
    description: `commit ${seed}`,
    author: "a",
    authoredAt: "2026-10-01T00:00:00Z",
    changeId,
  };
}

function version(number: number, commits: GitCommit[]): VersionCommits {
  return {
    version: { id: String(number), number, label: `v${number}` },
    commits,
  };
}

function comment(
  id: string,
  on: GitCommit,
  extra: Partial<Comment> = {},
): Comment {
  return {
    id,
    reviewKey: `change:${on.changeId}`,
    commitId: on.commitId,
    body: id,
    resolved: false,
    createdAt: "2026-10-01T00:00:00Z",
    author: "reader",
    replies: [],
    kind: "line",
    path: "a.ts",
    side: "after",
    line: 3,
    ...extra,
  } as Comment;
}

function drawn(of: Comment): RowComment {
  return { ...of, stale: false, numberedOn: "after" };
}

function file(path: string): FileDiff {
  return {
    status: "modified",
    path,
    binary: false,
    oldBlob: null,
    newBlob: null,
    patch: "",
    structural: { kind: "unavailable", reason: "" },
  };
}

// v1 has a, b. v2 rewrites a to a2 and drops b. v3 keeps a2 as it is.
const a = commit("a", "ka");
const b = commit("b", "kb");
const a2 = commit("c", "ka");
const versions = [version(1, [a, b]), version(2, [a2]), version(3, [a2])];

describe("seriesThreads", () => {
  test("writes a thread on the oldest version with its commit", () => {
    const [thread] = seriesThreads([comment("x", a2)], versions, new Map());
    expect(thread?.written.number).toBe(2);
  });

  test("leaves out a comment on no version's commit", () => {
    const other = commit("d", "kd");
    expect(seriesThreads([comment("x", other)], versions, new Map())).toEqual(
      [],
    );
  });

  test("calls a change the newest version lost dropped", () => {
    const threads = seriesThreads(
      [comment("on-a", a), comment("on-b", b)],
      versions,
      new Map(),
    );
    const dropped = Object.fromEntries(
      threads.map((thread) => [thread.comment.id, thread.dropped]),
    );
    expect(dropped).toEqual({ "on-a": false, "on-b": true });
  });

  test("never calls a commit with no change id dropped", () => {
    const loose = commit("e", null);
    const [thread] = seriesThreads(
      [comment("x", loose)],
      [version(1, [loose]), version(2, [a2])],
      new Map(),
    );
    expect(thread?.dropped).toBe(false);
  });

  test("orders newest version first, then by commit, then by age", () => {
    const threads = seriesThreads(
      [
        comment("b-late", b, { createdAt: "2026-10-03T00:00:00Z" }),
        comment("b-early", b, { createdAt: "2026-10-02T00:00:00Z" }),
        comment("a", a),
        comment("a2", a2),
      ],
      versions,
      new Map(),
    );
    expect(threads.map((thread) => thread.comment.id)).toEqual([
      "a2",
      "a",
      "b-early",
      "b-late",
    ]);
    expect(
      byVersion(threads).map((run) => [run.version.number, run.threads.length]),
    ).toEqual([
      [2, 1],
      [1, 3],
    ]);
  });
});

describe("drawnThreads", () => {
  const onFile = comment("line", a2);
  const onWhole = comment("whole", a2, {
    kind: "comparison",
  } as Partial<Comment>);

  test("draws a row's threads on the files it draws, and on the whole commit", () => {
    const shown = drawnThreads([
      {
        key: "row",
        commitId: a2.commitId,
        files: [file("a.ts")],
        comments: [drawn(onFile), drawn(onWhole)],
      },
    ]);
    expect([...shown.keys()]).toEqual(["line", "whole"]);
  });

  test("draws no thread on a file the row leaves out, as an unchanged row does", () => {
    const shown = drawnThreads([
      {
        key: "row",
        commitId: a2.commitId,
        files: [],
        comments: [drawn(onFile), drawn(onWhole)],
      },
    ]);
    expect([...shown.keys()]).toEqual(["whole"]);
  });

  test("draws nothing on a row still loading", () => {
    const shown = drawnThreads([
      {
        key: "row",
        commitId: a2.commitId,
        files: null,
        comments: [drawn(onWhole)],
      },
    ]);
    expect(shown.size).toBe(0);
  });
});

describe("threadsIn", () => {
  const threads = seriesThreads(
    [comment("open", a), comment("done", a, { resolved: true })],
    versions,
    new Map(),
  );
  test("filters by resolution", () => {
    const ids = (filter: "open" | "resolved" | "all") =>
      threadsIn(threads, filter).map((thread) => thread.comment.id);
    expect(ids("open")).toEqual(["open"]);
    expect(ids("resolved")).toEqual(["done"]);
    expect(ids("all")).toEqual(["open", "done"]);
  });
});

describe("threadPlace", () => {
  const place: SeriesPlace = {
    from: { kind: "version", id: "2" },
    to: null,
    spot: null,
  };
  const thread = (of: Comment, shown: Drawn | null): SeriesThread => {
    const [found] = seriesThreads(
      [of],
      versions,
      shown === null ? new Map() : new Map([[of.id, shown]]),
    );
    if (found === undefined) throw new Error("no thread");
    return found;
  };

  test("keeps the comparison for a thread it draws", () => {
    const of = comment("x", a2);
    const shown = {
      row: "r",
      commitId: a2.commitId,
      comment: drawn(of),
      patch: "",
    };
    expect(threadPlace(thread(of, shown), place, "3")).toEqual({
      from: { kind: "version", id: "2" },
      to: "3",
      spot: { commit: a2.commitId, file: { path: "a.ts", line: 3 } },
    });
  });

  test("opens the version a hidden thread was written on, against the base", () => {
    expect(threadPlace(thread(comment("x", b), null), place, "3")).toEqual({
      from: { kind: "base" },
      to: "1",
      spot: { commit: b.commitId, file: { path: "a.ts", line: 3 } },
    });
  });

  test("picks the file of a before-side line, which the address cannot hold", () => {
    const of = comment("x", b, { side: "before" } as Partial<Comment>);
    expect(threadPlace(thread(of, null), place, "3").spot?.file).toEqual({
      path: "a.ts",
      line: null,
    });
  });

  test("picks the commit alone for a thread on the whole commit", () => {
    const of = comment("x", b, { kind: "comparison" } as Partial<Comment>);
    expect(threadPlace(thread(of, null), place, "3").spot).toEqual({
      commit: b.commitId,
      file: null,
    });
  });
});
// ~/~ end
