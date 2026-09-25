# Review tracking

What the reader has already looked at, which of it has changed since, and
where the answer is kept between visits.

## Review state

`/api/interdiff` must never learn that review state exists. Every row it
returns costs a `jj` process, so a mark that triggered a refetch would spawn a
subprocess to record a click. The session document is read from
[`localStorage`](#session) on its own, independently of the interdiff fetch;
whichever row a mark or comment belongs to is worked out here, client-side,
from ids both already carry.

`reviewKey` picks `row.to ?? row.from`: the after side is the version being
approved, so when a row has a real after side that commit is the one whose
identity counts. `alignSeries` guarantees at least one side is present, so
only a row with neither side throws.

That commit's own id, not the row's, decides the key's shape: `change:${id}`
when it carries a jj change id, `rev:${id}` on its commit id when it does not.
A jj change id and a git commit id are drawn from different id spaces and
could collide as bare strings, so the prefix keeps a `change:` key and a
`rev:` key apart in the one `reviewKey` field a mark or comment is stored
under, with no schema change needed to say so.

The two kinds of key degrade differently. A change id survives an amend, so a
`change:` key still finds its row after the commit is rewritten, and
`reviewed` still reads `reviewed`. A `rev:` key names one exact revision, so
rewriting the commit it was built from changes the key outright and the row
reads `unseen`, never `reviewed`, because nothing durable was ever true about
that identity. That loses memory, but safely: a `rev:`-keyed row can never
falsely claim to have been reviewed. It stays useful in the one case that does
not require surviving a rewrite. If the identifying commit is untouched but
the other side of the comparison moves, the key is unchanged, the stored
triple no longer matches, and the row correctly reads `changed`.

A mark is identified by the full `(reviewKey, fromCommitId, toCommitId)`
triple, not by the review key alone. `alignSeries` can put one change id on
two rows in the same series, because a reorder is a drop and an insert of the
same change and both halves identify off the same surviving commit, so a mark
on one must not paint the other as reviewed or even as changed. They are
different comparisons that share an identity only by coincidence of the
algorithm. Reading takes the same care writing does: `reviewed` needs an exact
triple match, and `changed` needs more than a shared review key, or the same
bug resurfaces one layer up.

A mark counts toward `changed` when it fills the same sides as the row, or
when it shares one: the same `fromCommitId` because an amend moved the after
side, or the same `toCommitId` because a rebase moved the before side. Sharing
a side alone is not enough, because a rebase that rewrites both sides at once
shares neither, and reporting a change the reader has already looked at as
`unseen` loses the memory the session exists to keep. Filling the same sides
alone is not enough either, because a change that was a modification and is
now a drop fills different slots while being the same thing the reader
reviewed. The two together leave exactly one pair unrelated, which is the pair
that has to be: the drop half of a reorder (`from: A, to: null`) and its
insert half (`from: null, to: A`) neither share a side nor fill the same
slots, so a mark on one leaves the other `unseen`. The insert is a comparison
the reader has never looked at.

A comment is about one of three things, and its `Anchor` says which: a line
on one `side` of a file, a whole file, or the whole comparison the row stands
for. The anchor's fields sit on the comment itself rather than under a field
of their own, so a line comment stored before files and comparisons took
comments is still a valid line comment: the `kind` it lacks defaults to
`line`, the way its missing `side` defaults to `after`. Nesting the anchor
would need a migration written in front of the schema, and a session that
fails to parse is [replaced with an empty one](#session), so a bug in that
migration would cost every reader every comment.

A comment's `stale` flag asks whether what the note is about still reads as
it did when the note was written, a narrower question than a mark's `changed`
state. Its `commitId` names the version it was read against, and it is stale
when neither of the row's current sides is that commit. The rule is the same
for every anchor. A file comment could instead stay fresh until the file's own
blob changed, which would spare it a rewrite that touched only other files,
but a line comment already goes stale on any rewrite of its commit, and a
second rule would need a second id on every comment to mean something
slightly different by the same word.

Which commit that is depends on the row. A paired row compares two commits, so
the after side is `to` and the before side is `from`. A lone row is one
commit's own diff against its parent, so that commit is the one version the
row names and it stands for both sides. `addComment` picks `from ?? to` for a
before-side line and `to ?? from` for everything else, since a file or a
comparison is read as the version being approved. The stale rule needs no side
of its own: a rewrite of either commit moves it off the row.

```ts
//| id: frontend-state-review
//| file: src/frontend/state/review.ts
import * as z from "zod";
import type { InterdiffRow } from "../api";

const Comparison = z.object({
  reviewKey: z.string(),
  fromCommitId: z.string().nullable(),
  toCommitId: z.string().nullable(),
});

export const Mark = Comparison.extend({ seenAt: z.string() });
export type Mark = z.infer<typeof Mark>;

export const Side = z.enum(["before", "after"]);
export type Side = z.infer<typeof Side>;

/** Where on a file a line comment is pinned: a line number on one side. */
export interface LineAnchor {
  side: Side;
  line: number;
}

/** What a comment is about: one line of a file, a whole file, or the whole
 *  comparison. A stored comment with no kind is a line comment, and one with
 *  no side is on the after side. Defaulting both keeps `load` from
 *  discarding a whole session written before either field. */
export const Anchor = z.union([
  z.object({
    kind: z.literal("line").default("line"),
    path: z.string(),
    side: Side.default("after"),
    line: z.number().int(),
  }),
  z.object({ kind: z.literal("file"), path: z.string() }),
  z.object({ kind: z.literal("comparison") }),
]);
export type Anchor = z.infer<typeof Anchor>;

export const Comment = z.intersection(
  z.object({
    id: z.string(),
    reviewKey: z.string(),
    commitId: z.string(),
    body: z.string(),
    resolved: z.boolean(),
    createdAt: z.string(),
  }),
  Anchor,
);
export type Comment = z.infer<typeof Comment>;

export const SessionDocument = z.object({
  marks: z.array(Mark),
  comments: z.array(Comment),
});
export type SessionDocument = z.infer<typeof SessionDocument>;

export type RowReview =
  | { state: "unseen" }
  | { state: "reviewed"; seenAt: string }
  | {
      state: "changed";
      seenAt: string;
      seenFrom: string | null;
      seenTo: string | null;
    };

export type RowComment = Comment & { stale: boolean };

export interface ReviewedRow extends InterdiffRow {
  reviewKey: string;
  review: RowReview;
  comments: RowComment[];
}

/** What a mark uses to find its row again. A change id survives a rewrite, so
 *  a mark under one is still recognisable after the commit is amended. A
 *  backend with no change ids can only name an exact revision, so a rewrite
 *  yields a different key and the row reads as unseen, never as reviewed. */
export function reviewKey(row: InterdiffRow): string {
  const commit = row.to ?? row.from;
  if (commit === null) {
    throw new Error("interdiff row has no commit on either side");
  }
  return commit.changeId !== null
    ? `change:${commit.changeId}`
    : `rev:${commit.commitId}`;
}

function latestMark(marks: Mark[]): Mark | null {
  return marks.reduce<Mark | null>(
    (latest, mark) =>
      latest === null || mark.seenAt > latest.seenAt ? mark : latest,
    null,
  );
}

/** Whether a mark describes the same comparison slot: both sides, or which
 * single side, the row fills. A reorder's drop and insert halves fill
 * opposite slots, so neither can speak for the other. */
function fillsSameSides(
  mark: Mark,
  fromCommitId: string | null,
  toCommitId: string | null,
): boolean {
  return (
    (mark.fromCommitId === null) === (fromCommitId === null) &&
    (mark.toCommitId === null) === (toCommitId === null)
  );
}

function reviewFor(
  marksForChange: Mark[],
  fromCommitId: string | null,
  toCommitId: string | null,
): RowReview {
  const exact = marksForChange.find(
    (mark) =>
      mark.fromCommitId === fromCommitId && mark.toCommitId === toCommitId,
  );
  if (exact !== undefined) return { state: "reviewed", seenAt: exact.seenAt };

  const related = marksForChange.filter(
    (mark) =>
      fillsSameSides(mark, fromCommitId, toCommitId) ||
      mark.fromCommitId === fromCommitId ||
      mark.toCommitId === toCommitId,
  );
  const latest = latestMark(related);
  if (latest === null) return { state: "unseen" };
  return {
    state: "changed",
    seenAt: latest.seenAt,
    seenFrom: latest.fromCommitId,
    seenTo: latest.toCommitId,
  };
}

export function reviewRows(
  rows: InterdiffRow[],
  document: SessionDocument,
): ReviewedRow[] {
  return rows.map((row) => {
    const key = reviewKey(row);
    const fromCommitId = row.from?.commitId ?? null;
    const toCommitId = row.to?.commitId ?? null;
    const marksForChange = document.marks.filter(
      (mark) => mark.reviewKey === key,
    );

    const comments = document.comments
      .filter((comment) => comment.reviewKey === key)
      .map((comment) => ({
        ...comment,
        stale:
          comment.commitId !== fromCommitId && comment.commitId !== toCommitId,
      }))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    return {
      ...row,
      reviewKey: key,
      review: reviewFor(marksForChange, fromCommitId, toCommitId),
      comments,
    };
  });
}

/** Whether two marks (or a mark and a comparison) name the same row: the
 * same change id filling the same before/after slots. Exported so the
 * session store can replace or remove a mark by the same key it is read
 * back by. */
export function sameComparison(
  a: {
    reviewKey: string;
    fromCommitId: string | null;
    toCommitId: string | null;
  },
  b: {
    reviewKey: string;
    fromCommitId: string | null;
    toCommitId: string | null;
  },
): boolean {
  return (
    a.reviewKey === b.reviewKey &&
    a.fromCommitId === b.fromCommitId &&
    a.toCommitId === b.toCommitId
  );
}
```

The reorder case runs `alignSeries` for real rather than using a hand-rolled
fixture. The bug this schema guards against is in how `alignSeries`'s output
becomes review state, and a fixture written by hand could encode the same
wrong assumption the code is being tested against.

```ts
//| id: frontend-state-review-test
//| file: src/frontend/state/review.test.ts
import { describe, expect, test } from "bun:test";
import { alignSeries } from "../../backend/commit/series";
import type { InterdiffRow, LogEntry } from "../api";
import { reviewKey, reviewRows, SessionDocument } from "./review";

function logEntry(changeId: string, commitId: string): LogEntry {
  return { ...blank, changeId, commitId };
}

function gitLogEntry(commitId: string): LogEntry {
  return { ...blank, changeId: null, commitId };
}

const blank = {
  changeId: null,
  commitId: "",
  description: "",
  parents: [],
  author: "",
  timestamp: "2026-01-01T00:00:00Z",
  refs: [],
  markers: [],
} satisfies LogEntry;

function pairRow(
  changeId: string,
  fromCommitId: string,
  toCommitId: string,
): InterdiffRow {
  return {
    from: logEntry(changeId, fromCommitId),
    to: logEntry(changeId, toCommitId),
    files: [],
  };
}

describe("reviewRows", () => {
  test("leaves a row unseen against an empty document", () => {
    // arrange
    const row = pairRow("a", "a1", "a2");
    const document: SessionDocument = { marks: [], comments: [] };

    // act
    const [reviewed] = reviewRows([row], document);

    // assert
    expect(reviewed?.review).toEqual({ state: "unseen" });
  });

  test("marks a row reviewed on an exact triple match", () => {
    // arrange
    const row = pairRow("a", "a1", "a2");
    const document: SessionDocument = {
      marks: [
        {
          reviewKey: "change:a",
          fromCommitId: "a1",
          toCommitId: "a2",
          seenAt: "2026-09-14T09:00:00.000Z",
        },
      ],
      comments: [],
    };

    // act
    const [reviewed] = reviewRows([row], document);

    // assert
    expect(reviewed?.review).toEqual({
      state: "reviewed",
      seenAt: "2026-09-14T09:00:00.000Z",
    });
  });

  test("marks a row changed when the after side has moved on", () => {
    // arrange
    const row = pairRow("a", "a1", "a3");
    const document: SessionDocument = {
      marks: [
        {
          reviewKey: "change:a",
          fromCommitId: "a1",
          toCommitId: "a2",
          seenAt: "2026-09-14T09:00:00.000Z",
        },
      ],
      comments: [],
    };

    // act
    const [reviewed] = reviewRows([row], document);

    // assert
    expect(reviewed?.review).toEqual({
      state: "changed",
      seenAt: "2026-09-14T09:00:00.000Z",
      seenFrom: "a1",
      seenTo: "a2",
    });
  });

  test("marks a row changed when the before side has moved on", () => {
    // arrange
    const row = pairRow("a", "a0", "a2");
    const document: SessionDocument = {
      marks: [
        {
          reviewKey: "change:a",
          fromCommitId: "a1",
          toCommitId: "a2",
          seenAt: "2026-09-14T09:00:00.000Z",
        },
      ],
      comments: [],
    };

    // act
    const [reviewed] = reviewRows([row], document);

    // assert
    expect(reviewed?.review).toEqual({
      state: "changed",
      seenAt: "2026-09-14T09:00:00.000Z",
      seenFrom: "a1",
      seenTo: "a2",
    });
  });

  test("marks a row changed when a rebase moved both sides at once", () => {
    // arrange
    const row = pairRow("a", "a3", "a4");
    const document: SessionDocument = {
      marks: [
        {
          reviewKey: "change:a",
          fromCommitId: "a1",
          toCommitId: "a2",
          seenAt: "2026-09-14T09:00:00.000Z",
        },
      ],
      comments: [],
    };

    // act
    const [reviewed] = reviewRows([row], document);

    // assert
    expect(reviewed?.review).toEqual({
      state: "changed",
      seenAt: "2026-09-14T09:00:00.000Z",
      seenFrom: "a1",
      seenTo: "a2",
    });
  });

  test("leaves the other half of a reorder unseen, not changed", () => {
    // arrange
    const A = logEntry("aaaa", "a1");
    const B = logEntry("bbbb", "b1");
    const rows = alignSeries([A, B], [B, A]).map((pair) => ({
      ...pair,
      files: [],
    }));
    const changeARows = reviewRows(rows, { marks: [], comments: [] }).filter(
      (row) => row.reviewKey === "change:aaaa",
    );
    const dropped = changeARows.find((row) => row.to === null);
    if (dropped === undefined) {
      throw new Error("expected a dropped row for change aaaa");
    }
    const document: SessionDocument = {
      marks: [
        {
          reviewKey: "change:aaaa",
          fromCommitId: dropped.from?.commitId ?? null,
          toCommitId: dropped.to?.commitId ?? null,
          seenAt: "2026-09-14T09:00:00.000Z",
        },
      ],
      comments: [],
    };

    // act
    const inserted = reviewRows(rows, document).find(
      (row) => row.reviewKey === "change:aaaa" && row.from === null,
    );

    // assert
    expect(rows).toHaveLength(3);
    expect(changeARows).toHaveLength(2);
    expect(inserted?.review).toEqual({ state: "unseen" });
  });

  test("flags a comment stale when its commit is on neither side of the row", () => {
    // arrange
    const row = pairRow("a", "a1", "a2");
    const document: SessionDocument = {
      marks: [],
      comments: [
        {
          id: "c1",
          reviewKey: "change:a",
          kind: "line",
          path: "f.ts",
          side: "after",
          line: 3,
          commitId: "a0",
          body: "old",
          resolved: false,
          createdAt: "2026-09-14T09:00:00.000Z",
        },
      ],
    };

    // act
    const [reviewed] = reviewRows([row], document);

    // assert
    expect(reviewed?.comments[0]?.stale).toBe(true);
  });

  test("keeps a before-side comment fresh while its commit is the row's before side", () => {
    // arrange
    const row = pairRow("a", "a1", "a2");
    const document: SessionDocument = {
      marks: [],
      comments: [
        {
          id: "c1",
          reviewKey: "change:a",
          kind: "line",
          path: "f.ts",
          side: "before",
          line: 3,
          commitId: "a1",
          body: "removed too soon",
          resolved: false,
          createdAt: "2026-09-14T09:00:00.000Z",
        },
      ],
    };

    // act
    const [reviewed] = reviewRows([row], document);

    // assert
    expect(reviewed?.comments[0]?.stale).toBe(false);
  });

  test("keeps a file comment fresh while its commit is the row's after side", () => {
    // arrange
    const row = pairRow("a", "a1", "a2");
    const document: SessionDocument = {
      marks: [],
      comments: [
        {
          id: "c1",
          reviewKey: "change:a",
          kind: "file",
          path: "f.ts",
          commitId: "a2",
          body: "split this file",
          resolved: false,
          createdAt: "2026-09-14T09:00:00.000Z",
        },
      ],
    };

    // act
    const [reviewed] = reviewRows([row], document);

    // assert
    expect(reviewed?.comments[0]?.stale).toBe(false);
  });

  test("flags a comparison comment stale once both sides have been rewritten", () => {
    // arrange
    const row = pairRow("a", "a3", "a4");
    const document: SessionDocument = {
      marks: [],
      comments: [
        {
          id: "c1",
          reviewKey: "change:a",
          kind: "comparison",
          commitId: "a2",
          body: "squash this into its parent",
          resolved: false,
          createdAt: "2026-09-14T09:00:00.000Z",
        },
      ],
    };

    // act
    const [reviewed] = reviewRows([row], document);

    // assert
    expect(reviewed?.comments[0]?.stale).toBe(true);
  });

  test("derives unseen for a change-id-less row against an empty document", () => {
    // arrange
    const row: InterdiffRow = {
      from: gitLogEntry("g1"),
      to: gitLogEntry("g2"),
      files: [],
    };
    const document: SessionDocument = { marks: [], comments: [] };

    // act
    const [reviewed] = reviewRows([row], document);

    // assert
    expect(reviewed?.review).toEqual({ state: "unseen" });
  });

  test("marks a change-id-less row reviewed on an exact triple match", () => {
    // arrange
    const row: InterdiffRow = {
      from: gitLogEntry("g1"),
      to: gitLogEntry("g2"),
      files: [],
    };
    const document: SessionDocument = {
      marks: [
        {
          reviewKey: "rev:g2",
          fromCommitId: "g1",
          toCommitId: "g2",
          seenAt: "2026-09-14T09:00:00.000Z",
        },
      ],
      comments: [],
    };

    // act
    const [reviewed] = reviewRows([row], document);

    // assert
    expect(reviewed?.review).toEqual({
      state: "reviewed",
      seenAt: "2026-09-14T09:00:00.000Z",
    });
  });

  test("reads unseen, not reviewed or changed, once a change-id-less row's identifying commit is rewritten", () => {
    // arrange
    const row: InterdiffRow = {
      from: gitLogEntry("g1"),
      to: gitLogEntry("g2-rewritten"),
      files: [],
    };
    const document: SessionDocument = {
      marks: [
        {
          reviewKey: "rev:g2",
          fromCommitId: "g1",
          toCommitId: "g2",
          seenAt: "2026-09-14T09:00:00.000Z",
        },
      ],
      comments: [],
    };

    // act
    const [reviewed] = reviewRows([row], document);

    // assert
    expect(reviewed?.review).toEqual({ state: "unseen" });
  });

  test("marks a change-id-less row changed when the other side has moved on", () => {
    // arrange
    const row: InterdiffRow = {
      from: gitLogEntry("g1-new"),
      to: gitLogEntry("g2"),
      files: [],
    };
    const document: SessionDocument = {
      marks: [
        {
          reviewKey: "rev:g2",
          fromCommitId: "g1",
          toCommitId: "g2",
          seenAt: "2026-09-14T09:00:00.000Z",
        },
      ],
      comments: [],
    };

    // act
    const [reviewed] = reviewRows([row], document);

    // assert
    expect(reviewed?.review).toEqual({
      state: "changed",
      seenAt: "2026-09-14T09:00:00.000Z",
      seenFrom: "g1",
      seenTo: "g2",
    });
  });
});

describe("SessionDocument", () => {
  test("reads a comment stored without a kind or a side as an after-side line comment", () => {
    // arrange
    const stored = {
      marks: [],
      comments: [
        {
          id: "c1",
          reviewKey: "change:a",
          path: "f.ts",
          line: 3,
          commitId: "a2",
          body: "written before sides",
          resolved: false,
          createdAt: "2026-09-14T09:00:00.000Z",
        },
      ],
    };

    // act
    const document = SessionDocument.parse(stored);

    // assert
    expect(document.comments[0]).toMatchObject({
      kind: "line",
      path: "f.ts",
      side: "after",
      line: 3,
    });
  });

  test("reads file and comparison comments back as themselves", () => {
    // arrange
    const written = {
      reviewKey: "change:a",
      commitId: "a2",
      body: "",
      resolved: false,
      createdAt: "2026-09-14T09:00:00.000Z",
    };
    const stored = {
      marks: [],
      comments: [
        { ...written, id: "c1", kind: "file" as const, path: "f.ts" },
        { ...written, id: "c2", kind: "comparison" as const },
      ],
    };

    // act
    const document = SessionDocument.parse(stored);

    // assert
    expect(document.comments).toEqual(stored.comments);
  });

  test("rejects a file comment with no path", () => {
    // arrange
    const stored = {
      marks: [],
      comments: [
        {
          id: "c1",
          reviewKey: "change:a",
          kind: "file",
          commitId: "a2",
          body: "",
          resolved: false,
          createdAt: "2026-09-14T09:00:00.000Z",
        },
      ],
    };

    // act
    const parsed = SessionDocument.safeParse(stored);

    // assert
    expect(parsed.success).toBe(false);
  });
});

describe("reviewKey", () => {
  test("keeps a jj row and a git row apart even when the literal id matches", () => {
    // arrange
    const jjRow: InterdiffRow = {
      from: null,
      to: logEntry("shared", "c1"),
      files: [],
    };
    const gitRow: InterdiffRow = {
      from: null,
      to: gitLogEntry("shared"),
      files: [],
    };

    // act
    const jjKey = reviewKey(jjRow);
    const gitKey = reviewKey(gitRow);

    // assert
    expect(jjKey).toBe("change:shared");
    expect(gitKey).toBe("rev:shared");
    expect(jjKey).not.toBe(gitKey);
  });
});
```

A comment or a comparison row is always in one of the same three states —
still open, resolved, or stale against a rewrite since it was written — and
`--review-open`, `--review-resolved`, and `--review-stale` are the one set
of roles that both the tone chip on a comparison header and the accent on a
comment thread read from. A resolved comment and a resolved row share a
colour without either file naming it.

```css
/*| id: design-review-state
@layer components {
  .review-chip {
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-large);
    font-size: var(--text-size-small);
  }

  .review-chip--resolved {
    background: var(--review-seen-surface);
    color: var(--review-resolved);
    border: 1px solid var(--review-seen-border);
  }

  .review-chip--stale {
    background: var(--review-changed-surface);
    color: var(--review-stale);
    border: 1px solid var(--review-changed-border);
  }

  .review-chip--open {
    background: var(--review-open-surface);
    color: var(--review-open);
    border: 1px solid var(--review-open-border);
  }

  .comment-thread {
    padding: var(--space-3) var(--space-4);
    margin: var(--space-2) var(--space-4);
    border-left: var(--border-width-accent) solid var(--review-open);
  }

  .comment-thread--resolved {
    border-left-color: var(--review-resolved);
    opacity: 0.72;
  }

  .comment-thread__meta {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    color: var(--text-faint);
  }

  .comment-thread__stale {
    color: var(--review-stale);
  }
}
```
## Session

The session belongs to whoever is reading, not to the repository being read,
so it lives in the browser. It used to live in a SQLite file under `.jj/`,
which put diffy's own bookkeeping inside the directory of the tool being
reviewed. `.jj/` is jj's. A reviewer's marks and comments are diffy's
business, and a database only jj is supposed to manage sitting in that
directory was a surprise waiting to happen, whatever the file format. A
different path on the server would not have fixed that.

`window.localStorage` replaces it: built into every browser, no dependency to
add, and synchronous. `IndexedDB` was the other browser-native option and
loses on that last point. A `fetch` needs a loading state; a synchronous read
does not, because the data is there by the time a component first renders. A
`fetch` needs an optimistic update held apart from server truth until a
response confirms it; a synchronous write has no "in flight" to be optimistic
about. A `fetch` needs a failure path that reconciles a rejected write against
whatever the server ended up holding; a synchronous write either succeeds or
throws where it is called. All three collapse into a plain `useState`, because
all three only existed to cover a round trip that is now gone.

The session follows the browser rather than the repo, and that costs
something. It does not survive clearing site data. It is not shared between
two browsers, or between two machines working from the same clone. Because
[`just serve` gives each workspace its own port](../../devtools/serving.md),
browser storage is partitioned by origin, and an origin includes the port, two
workspaces of the same repo reviewed side by side get two separate sessions,
which is usually what is wanted. A different repo served later on a port an
earlier repo used inherits that repo's stored marks. Those marks carry change
ids no row in the new repo will ever match, so they render as nothing, but
they accumulate in `localStorage`. That is accepted on the same "good enough
for one reader in one browser" grounds as the rest of this design. A reviewer
working from two machines, or a session that has to outlive clearing browser
data, wants a server-side store keyed by repo, which is a feature to build
rather than a small addition to this one.

`SessionEdit` is gone along with the database. It existed so one edit value
could be applied to a local copy and posted verbatim, letting the client's
`applyEdit` and the backend's `applyEdit` compute the same document from the
same input without being reconciled. That argument needs two implementations
that could disagree. With no server there is one mutation and one place it
runs, so `SessionEdit` had stopped describing a mutation and become a dispatch
layer between a mutator that knew what it wanted to do and a `switch` that
re-derived the same thing from a `kind` field. The union and `applyEdit` are
gone, and each mutator below builds the next document directly.

`useSession` reads the stored document once, lazily, as the initial value of a
single `useState<SessionDocument>`. It passes `useState(load)` rather than
`useState(load())`, so the read happens once rather than racing every render.
`load` parses whatever sits under the storage key with the `SessionDocument`
Zod schema and falls back to an empty document on anything that does not
parse: absent, truncated by a full quota, or hand-edited in devtools into some
other shape. Content read out of `localStorage` is external input the way a
request body was, so it gets the boundary discipline a request body used to
get on the server. A corrupt blob costs the reviewer their history, not the
ability to open the app.

`save` writes back through a `try`/`catch` that swallows a thrown write.
`localStorage.setItem` throws in Safari private browsing and whenever a tab is
over quota, and there is no error channel here to carry that failure anywhere.
The caller is a synchronous state update from inside a click handler, not a
promise with a `.catch` to hang one off. A session that keeps working for the
rest of the tab, without surviving a reload, beats throwing out of that click.
`Session` has no `error` field, because a persistence failure the reviewer
cannot act on is not worth a UI state.

Each mutator computes its next document from the current one and hands it to
`update`, the one place that writes to `localStorage` and calls `setDocument`.
This is the same five-way logic that used to live in `applyEdit`'s `switch`,
inlined at the call site that already knows which mutation it is making rather
than re-derived from a `kind` tag a layer away. `markSeen` decides mark versus
unmark from the row's own `review.state`, so callers never build a comparison
by hand. Every mutator is wrapped in `useCallback` closing only over the
stable `update` function rather than over `document`, so passing `markSeen`
through two layers of props does not retrigger effects that depend on it.

```tsx
//| id: frontend-state-session
//| file: src/frontend/state/session.ts
import { useCallback, useState } from "react";
import {
  type Anchor,
  type Comment,
  type ReviewedRow,
  SessionDocument,
  sameComparison,
} from "./review";

const STORAGE_KEY = "diffy.session.v1";
const EMPTY_DOCUMENT: SessionDocument = { marks: [], comments: [] };

/** localStorage content is written by a possibly older version of this
 * app, or by hand in devtools; treat it as untrusted input and fall back
 * to an empty session rather than let a bad blob break the app. */
export function load(): SessionDocument {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === null) return EMPTY_DOCUMENT;

  try {
    return SessionDocument.parse(JSON.parse(raw));
  } catch {
    return EMPTY_DOCUMENT;
  }
}

/** setItem throws in Safari private browsing and over quota; there is no
 * error channel from here back to a click handler, and a session that
 * keeps working for the tab without persisting beats one that throws. */
export function save(document: SessionDocument): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(document));
  } catch {
    // See the doc comment: persistence failure is not worth a UI state.
  }
}

export interface Session {
  document: SessionDocument;
  markSeen: (row: ReviewedRow) => void;
  addComment: (row: ReviewedRow, anchor: Anchor, body: string) => void;
  resolveComment: (id: string, resolved: boolean) => void;
  dropComment: (id: string) => void;
}

export function useSession(): Session {
  const [document, setDocument] = useState<SessionDocument>(load);

  const update = useCallback(
    (compute: (current: SessionDocument) => SessionDocument) => {
      setDocument((current) => {
        const next = compute(current);
        save(next);
        return next;
      });
    },
    [],
  );

  const markSeen = useCallback(
    (row: ReviewedRow) => {
      const comparison = {
        reviewKey: row.reviewKey,
        fromCommitId: row.from?.commitId ?? null,
        toCommitId: row.to?.commitId ?? null,
      };
      update((current) => {
        const marks = current.marks.filter(
          (mark) => !sameComparison(mark, comparison),
        );
        if (row.review.state === "reviewed") return { ...current, marks };
        return {
          ...current,
          marks: [
            ...marks,
            { ...comparison, seenAt: new Date().toISOString() },
          ],
        };
      });
    },
    [update],
  );

  const addComment = useCallback(
    (row: ReviewedRow, anchor: Anchor, body: string) => {
      const commit =
        anchor.kind === "line" && anchor.side === "before"
          ? (row.from ?? row.to)
          : (row.to ?? row.from);
      const comment: Comment = {
        id: crypto.randomUUID(),
        reviewKey: row.reviewKey,
        ...anchor,
        commitId: commit?.commitId ?? "",
        body,
        resolved: false,
        createdAt: new Date().toISOString(),
      };
      update((current) => ({
        ...current,
        comments: [...current.comments, comment],
      }));
    },
    [update],
  );

  const resolveComment = useCallback(
    (id: string, resolved: boolean) => {
      update((current) => ({
        ...current,
        comments: current.comments.map((comment) =>
          comment.id === id ? { ...comment, resolved } : comment,
        ),
      }));
    },
    [update],
  );

  const dropComment = useCallback(
    (id: string) => {
      update((current) => ({
        ...current,
        comments: current.comments.filter((comment) => comment.id !== id),
      }));
    },
    [update],
  );

  return { document, markSeen, addComment, resolveComment, dropComment };
}
```

The store's own tests live next to it, with an in-memory `localStorage`
stand-in, since `bun test` has no DOM to provide the real thing. `load` and
`save` are exported by name rather than kept private to the hook so those
tests can reach them without rendering a component. This project has no
renderer, and adding one to cover a `try`/`catch` would cost more than the two
functions it tests.

```ts
//| id: frontend-state-session-test
//| file: src/frontend/state/session.test.ts
import { beforeEach, describe, expect, test } from "bun:test";
import type { SessionDocument } from "./review";
import { load, save } from "./session";

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

describe("load", () => {
  test("round-trips a document through save", () => {
    // arrange
    const document: SessionDocument = {
      marks: [
        {
          reviewKey: "a",
          fromCommitId: "a1",
          toCommitId: "a2",
          seenAt: "2026-09-14T09:00:00.000Z",
        },
      ],
      comments: [],
    };

    // act
    save(document);

    // assert
    expect(load()).toEqual(document);
  });

  test("keeps the comments of a session stored before comments had kinds", () => {
    // arrange
    const comment = {
      id: "c1",
      reviewKey: "change:a",
      path: "f.ts",
      line: 3,
      commitId: "a2",
      body: "written before kinds",
      resolved: false,
      createdAt: "2026-09-14T09:00:00.000Z",
    };
    localStorage.setItem(
      "diffy.session.v1",
      JSON.stringify({ marks: [], comments: [comment] }),
    );

    // act
    // assert
    expect(load().comments).toEqual([
      { ...comment, kind: "line", side: "after" },
    ]);
  });

  test("loads an empty document when nothing is stored", () => {
    // arrange
    // act
    // assert
    expect(load()).toEqual({ marks: [], comments: [] });
  });

  test("loads an empty document when the stored value is not JSON", () => {
    // arrange
    localStorage.setItem("diffy.session.v1", "not json");

    // act
    // assert
    expect(load()).toEqual({ marks: [], comments: [] });
  });

  test("loads an empty document when the stored value has the wrong shape", () => {
    // arrange
    localStorage.setItem("diffy.session.v1", JSON.stringify({ foo: "bar" }));

    // act
    // assert
    expect(load()).toEqual({ marks: [], comments: [] });
  });
});

describe("save", () => {
  test("does not throw when the store throws", () => {
    // arrange
    globalThis.localStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota exceeded");
      },
    } as unknown as Storage;

    // act
    // assert
    expect(() => save({ marks: [], comments: [] })).not.toThrow();
  });
});
```
