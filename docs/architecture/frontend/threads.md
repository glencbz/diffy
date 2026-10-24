# Threads

A series screen lists every comment thread on the series, whatever its
comparison draws, in a [panel](panels.md) of its own.
A comparison draws a thread only on a row filed under the thread's key that
also draws its file. So an interdiff hides the threads on every change it calls
unchanged. A comparison against the base hides the threads on changes a later
version dropped. The tab names those threads and opens the comparison that
draws them.

## Which threads a series has

A thread belongs to a series when the commit it was written on is in one of
the series' versions. A comment's key alone cannot say this. A local
review's key is a change id, so it would name the right change but not which
version the comment was written on. A pull request's key starts at the commit
the reader first wrote on and follows [`pullRowKey`](review.md#review-state)
from there, and no version's commit list names it. Every version's commits are
loaded once for this ([`useEveryVersion`](series.md#reading-a-series)).

A thread is written on the oldest version that has its commit. A commit can sit
unchanged in several versions, and the oldest is where the reader read it. The
list groups threads by that version, newest first, so the threads the newest
round of work answers come first. A thread's change is dropped when the newest
version has no commit with its change id. A commit with no change id is never
called dropped, since nothing can say what became of it.

Whether the comparison on screen draws a thread comes from the rows it draws,
not from the thread. `drawnThreads` takes each row's comments, filed the way
[`reviewComparison`](review.md#review-state) files them, and keeps the threads
a row's files draw. It also keeps the threads on the whole commit, which every
row draws once open. A row still loading draws nothing yet.

A jump to a drawn thread stays in the comparison and picks its row, file, and
line. A jump to one that is not drawn opens the version it was written on
against the base, where its commit has a row of its own and its line is
numbered as written. The newest version would keep the reader's place but
could only show the thread as stale, at a line its commit may no longer have.

```ts
//| id: frontend-model-threads
//| file: src/frontend/model/threads.ts
import { shownPathOf } from "./changedFiles";
import type { FileDiff } from "./diff";
import type { GitCommit } from "./history";
import type { FileSpot, SeriesPlace } from "./place";
import { type Comment, drawnAt, type RowComment } from "./review";
import type { SeriesVersion } from "./series";

/** One version of a series and its commits, oldest first. */
export interface VersionCommits {
  version: SeriesVersion;
  commits: GitCommit[];
}

/** A row of the comparison on screen, as far as its threads go. */
export interface ShownRow {
  key: string;
  commitId: string;
  /** Null while the row's comparison loads. */
  files: FileDiff[] | null;
  /** Its comments as the row reads them. */
  comments: RowComment[];
}

/** Where the comparison on screen draws a thread. */
export interface Drawn {
  row: string;
  commitId: string;
  comment: RowComment;
  /** The patch of the file a line comment is on, to find its line in. */
  patch: string;
}

export interface SeriesThread {
  comment: Comment;
  /** The oldest version that has the commit it was written on. */
  written: SeriesVersion;
  commit: GitCommit;
  /** Null where the comparison on screen does not draw it. */
  drawn: Drawn | null;
  /** Whether the newest version has lost its change. */
  dropped: boolean;
}

export function drawnThreads(rows: ShownRow[]): Map<string, Drawn> {
  const drawn = new Map<string, Drawn>();
  for (const row of rows) {
    if (row.files === null) continue;
    const patches = new Map(
      row.files.map((file) => [shownPathOf(file), file.patch]),
    );
    for (const comment of row.comments) {
      const patch =
        comment.kind === "comparison" ? "" : patches.get(comment.path);
      if (patch === undefined) continue;
      drawn.set(comment.id, {
        row: row.key,
        commitId: row.commitId,
        comment,
        patch,
      });
    }
  }
  return drawn;
}

/** Every thread on the series, newest version first, then in commit order,
 *  then oldest first. */
export function seriesThreads(
  comments: Comment[],
  versions: VersionCommits[],
  drawn: Map<string, Drawn>,
): SeriesThread[] {
  const newest = new Set(
    versions.at(-1)?.commits.map((commit) => commit.changeId) ?? [],
  );
  const found: { thread: SeriesThread; index: number }[] = [];
  for (const comment of comments) {
    const at = writtenAt(versions, comment.commitId);
    if (at === null) continue;
    found.push({
      thread: {
        comment,
        written: at.version,
        commit: at.commit,
        drawn: drawn.get(comment.id) ?? null,
        dropped: at.commit.changeId !== null && !newest.has(at.commit.changeId),
      },
      index: at.index,
    });
  }
  return found
    .sort(
      (a, b) =>
        b.thread.written.number - a.thread.written.number ||
        a.index - b.index ||
        a.thread.comment.createdAt.localeCompare(b.thread.comment.createdAt),
    )
    .map(({ thread }) => thread);
}

function writtenAt(
  versions: VersionCommits[],
  commitId: string,
): { version: SeriesVersion; commit: GitCommit; index: number } | null {
  for (const { version, commits } of versions) {
    const index = commits.findIndex((commit) => commit.commitId === commitId);
    const commit = commits[index];
    if (commit !== undefined) return { version, commit, index };
  }
  return null;
}

export type ThreadFilter = "open" | "resolved" | "all";

export function threadsIn(
  threads: SeriesThread[],
  filter: ThreadFilter,
): SeriesThread[] {
  if (filter === "all") return threads;
  const resolved = filter === "resolved";
  return threads.filter((thread) => thread.comment.resolved === resolved);
}

/** Runs of threads written on the same version, in the order given. */
export function byVersion(
  threads: SeriesThread[],
): { version: SeriesVersion; threads: SeriesThread[] }[] {
  const runs: { version: SeriesVersion; threads: SeriesThread[] }[] = [];
  for (const thread of threads) {
    const last = runs.at(-1);
    if (last?.version.id === thread.written.id) last.threads.push(thread);
    else runs.push({ version: thread.written, threads: [thread] });
  }
  return runs;
}

/** Where a jump to a thread lands. `to` is the version the place shows. */
export function threadPlace(
  thread: SeriesThread,
  place: SeriesPlace,
  to: string,
): SeriesPlace {
  const { comment, drawn } = thread;
  const file: FileSpot | null =
    comment.kind === "comparison"
      ? null
      : { path: comment.path, line: afterLine(thread) };
  if (drawn !== null) {
    return { ...place, to, spot: { commit: drawn.commitId, file } };
  }
  return {
    from: { kind: "base" },
    to: thread.written.id,
    spot: { commit: comment.commitId, file },
  };
}

/** The after-side line a jump picks. A line drawn only on the before side has
 *  no number the address can hold, so the jump picks its file. */
function afterLine({ comment, drawn }: SeriesThread): number | null {
  if (comment.kind !== "line") return null;
  const at = drawn === null ? comment : drawnAt(drawn.comment, drawn.patch);
  return at?.side === "after" ? at.line : null;
}
```

## The thread list

Each thread folds to a line naming where it sits and whether the comparison
on screen draws it, over the start of what it says. Unfolded, it is the same
thread the diff draws, so a reply or a resolve from the list is the same
command as one from the diff. The list opens on open threads, since a resolved
one needs nothing more from the reader.

A thread the comparison does not draw reads with no line drawn, so its thread
says which commit and line it was written against, not that it is stale.

```tsx
//| id: frontend-view-thread-list
//| file: src/frontend/views/ThreadList.tsx
import { useState } from "react";
import type { ReviewActions, RowComment } from "../model/review";
import {
  byVersion,
  type SeriesThread,
  type ThreadFilter,
  threadsIn,
} from "../model/threads";
import { CommentThreads } from "./Comments";

const FILTERS: ThreadFilter[] = ["open", "resolved", "all"];

export function ThreadList({
  threads,
  actions,
  onGo,
}: {
  threads: SeriesThread[];
  /** Null while there is no review document to write to. */
  actions: ReviewActions | null;
  onGo: (thread: SeriesThread) => void;
}) {
  const [filter, setFilter] = useState<ThreadFilter>("open");
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(new Set());
  const unfold = (id: string, open: boolean) =>
    setUnfolded((now) => {
      const next = new Set(now);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });
  const shown = threadsIn(threads, filter);

  return (
    <div className="thread-list">
      <div className="thread-list__filters">
        {FILTERS.map((each) => (
          <button
            type="button"
            key={each}
            aria-pressed={filter === each}
            onClick={() => setFilter(each)}
            className="thread-list__filter"
          >
            {each}{" "}
            <span className="thread-list__count">
              {threadsIn(threads, each).length}
            </span>
          </button>
        ))}
      </div>
      {shown.length === 0 && (
        <p className="thread-list__empty">
          {threads.length === 0
            ? "No comments on this review yet."
            : `No ${filter} threads.`}
        </p>
      )}
      {byVersion(shown).map(({ version, threads: run }) => (
        <section key={version.id} className="thread-list__version">
          <h3 className="thread-list__heading">
            Written on v{version.number}
            <span className="thread-list__label">{version.label}</span>
          </h3>
          <ul className="thread-list__threads">
            {run.map((thread) => (
              <ThreadEntry
                key={thread.comment.id}
                thread={thread}
                actions={actions}
                onGo={() => onGo(thread)}
                unfolded={unfolded.has(thread.comment.id)}
                onUnfold={(open) => unfold(thread.comment.id, open)}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function ThreadEntry({
  thread,
  actions,
  onGo,
  unfolded,
  onUnfold,
}: {
  thread: SeriesThread;
  actions: ReviewActions | null;
  onGo: () => void;
  unfolded: boolean;
  onUnfold: (open: boolean) => void;
}) {
  const { comment } = thread;
  const replies = comment.replies.length;
  return (
    <li
      className={
        comment.resolved
          ? "thread-entry thread-entry--resolved"
          : "thread-entry"
      }
    >
      <div className="thread-entry__line">
        <button
          type="button"
          aria-expanded={unfolded}
          aria-label={unfolded ? "fold thread" : "unfold thread"}
          onClick={() => onUnfold(!unfolded)}
          className="thread-entry__fold"
        >
          {unfolded ? "▾" : "▸"}
        </button>
        <button type="button" onClick={onGo} className="thread-entry__where">
          {whereOf(thread)}
        </button>
        <span
          className={`thread-entry__shown thread-entry__shown--${shown(thread)}`}
        >
          {SHOWN[shown(thread)]}
        </span>
        {replies > 0 && (
          <span className="thread-entry__replies">
            {replies === 1 ? "1 reply" : `${replies} replies`}
          </span>
        )}
        {actions !== null && (
          <button
            type="button"
            onClick={() =>
              actions.resolveComment(comment.id, !comment.resolved)
            }
            className="thread-entry__resolve"
          >
            {comment.resolved ? "reopen" : "resolve"}
          </button>
        )}
      </div>
      {unfolded && actions !== null ? (
        <div className="thread-entry__thread">
          <CommentThreads
            comments={[asDrawn(thread)]}
            patch={thread.drawn?.patch}
            onEditComment={actions.editComment}
            onResolveComment={actions.resolveComment}
            onDropComment={actions.dropComment}
            onReplyToComment={actions.replyToComment}
            onEditReply={actions.editReply}
            onDropReply={actions.dropReply}
          />
          <button type="button" onClick={onGo} className="thread-entry__go">
            {thread.drawn !== null
              ? "show it in the diff"
              : `open v${thread.written.number}, where it was written`}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => onUnfold(true)}
          className="thread-entry__excerpt"
        >
          {comment.body}
        </button>
      )}
    </li>
  );
}

type Shown = "drawn" | "hidden" | "dropped";

const SHOWN: Record<Shown, string> = {
  drawn: "in view",
  hidden: "not in view",
  dropped: "change dropped",
};

function shown(thread: SeriesThread): Shown {
  if (thread.drawn !== null) return "drawn";
  return thread.dropped ? "dropped" : "hidden";
}

/** The file's name, not its path: the list is narrow, and the subject of the
 *  thread's commit is a click away. */
function whereOf({ comment }: SeriesThread): string {
  if (comment.kind === "comparison") return "whole commit";
  const name = comment.path.split("/").at(-1) ?? comment.path;
  if (comment.kind === "file") return name;
  return comment.side === "after"
    ? `${name}:${comment.line}`
    : `${name}:${comment.line}, before`;
}

function asDrawn(thread: SeriesThread): RowComment {
  return (
    thread.drawn?.comment ?? {
      ...thread.comment,
      stale: false,
      numberedOn: null,
    }
  );
}
```

## Styling

```css
/*| id: design-threads
@layer components {
  .thread-list {
    padding-bottom: var(--space-3);
  }

  .thread-list__filters {
    display: flex;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-5) var(--space-2);
  }

  .thread-list__filter {
    padding: var(--space-1) var(--space-3);
    font: inherit;
    font-size: var(--text-size-small);
    color: var(--text-muted);
    cursor: pointer;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-large);
  }

  .thread-list__filter[aria-pressed="true"] {
    color: var(--text);
    background: var(--surface-selected);
    border-color: var(--accent);
  }

  .thread-list__count,
  .thread-list__label,
  .thread-entry__replies {
    color: var(--text-faint);
  }

  .thread-list__empty {
    margin: 0;
    padding: var(--space-2) var(--space-5);
    color: var(--text-faint);
  }

  .thread-list__heading {
    display: flex;
    gap: var(--space-3);
    align-items: baseline;
    margin: 0;
    padding: var(--space-3) var(--space-5) var(--space-1);
    font-size: var(--text-size-small);
  }

  .thread-list__label {
    font-weight: normal;
  }

  .thread-list__threads {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .thread-entry__line {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-3);
    align-items: baseline;
    padding: var(--space-1) var(--space-5) 0;
    font-size: var(--text-size-small);
  }

  .thread-entry__fold,
  .thread-entry__where,
  .thread-entry__resolve,
  .thread-entry__go,
  .thread-entry__excerpt {
    padding: 0;
    font: inherit;
    cursor: pointer;
    background: none;
    border: none;
  }

  .thread-entry__fold {
    width: 1em;
    color: var(--text-faint);
  }

  .thread-entry__where,
  .thread-entry__go {
    color: var(--accent);
  }

  .thread-entry__where:hover,
  .thread-entry__go:hover {
    text-decoration: underline;
  }

  .thread-entry__shown--drawn {
    color: var(--review-open);
  }

  .thread-entry__shown--hidden,
  .thread-entry__shown--dropped {
    color: var(--review-stale);
  }

  /* Always shown, since a phone has no hover to reveal it. */
  .thread-entry__resolve {
    margin-left: auto;
    color: var(--text-muted);
  }

  /* Two lines of what it says, lined up under the location, not the fold. */
  .thread-entry__excerpt {
    display: -webkit-box;
    width: 100%;
    padding: 0 var(--space-5) var(--space-2)
      calc(var(--space-5) + 1em + var(--space-3));
    overflow: hidden;
    color: var(--text);
    text-align: left;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
  }

  .thread-entry--resolved .thread-entry__excerpt {
    color: var(--text-faint);
  }

  .thread-entry__thread {
    padding-bottom: var(--space-3);
  }

  .thread-entry__go {
    margin: 0 var(--space-4);
    font-size: var(--text-size-small);
  }
}
```

## Tests

```ts
//| id: frontend-model-threads-test
//| file: src/frontend/model/threads.test.ts
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
```
