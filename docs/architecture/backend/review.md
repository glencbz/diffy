# The review session

Reading a re-pushed branch is not one sitting. The reader gets through three
commits, the author pushes a fix, and the reader comes back the next morning to
a branch whose commit ids have all moved. What has to come back with them is
what they already read and what they said about it. That memory is the review
session: a set of *marks*, one per comparison already read, and a set of
*comments*.

The session is the only thing in diffy that is not derivable from the repo, so
it is the only thing with a database behind it.

## What the server stores, and what it does not

Two routes, and they are as dumb as a key-value store:

* `GET /api/session` hands over the whole document, every mark and every
  comment.
* `POST /api/session` takes exactly one edit and answers 204.

[`/api/interdiff`](server.md) is untouched by any of this and must stay that
way. Every row it returns costs a `jj` process, and marking a row as read is a
click. If review state were mixed into that response, the mark would have to
re-ask jj for the diff it is a mark *about*. So the diff and the session are
fetched separately, and which row a mark belongs to is worked out
[in the browser](../frontend.md#review-state) from ids both sides already hold.

That also settles what the server has to understand about a mark: nothing. It
never compares a mark to a commit, because it never sees a commit.

## Where it lives

`.jj/diffy-session.sqlite`, relative to the process's working directory, and
`DIFFY_SESSION_DB` overrides the whole path so tests can write to a tmpdir.

`.jj/` is the one place in a jj repo where a file can sit still. jj snapshots
the working copy on every command, so a database at the repo root would be
snapshotted into the working-copy commit and turn up in the diff of the very
repo being reviewed — the reviewer's notes, in the review. `.jj/` is never
snapshotted, and `.jj/.gitignore` holds `/*`, so a colocated git repo does not
see it either.

SQLite rather than a JSON file next to it. A JSON document has to be rewritten
whole on every mark, which is one badly-timed crash away from an empty session,
and diffy is already a Bun program, so `bun:sqlite` costs a single import and
no dependency.

## Schema

```ts
//| id: review-session-schema
const SCHEMA = `
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS mark (
  change_id      TEXT NOT NULL,
  from_commit_id TEXT NOT NULL,
  to_commit_id   TEXT NOT NULL,
  seen_at        TEXT NOT NULL,
  PRIMARY KEY (change_id, from_commit_id, to_commit_id)
) STRICT;

CREATE TABLE IF NOT EXISTS comment (
  id         TEXT PRIMARY KEY,
  change_id  TEXT NOT NULL,
  path       TEXT NOT NULL,
  line       INTEGER NOT NULL,
  commit_id  TEXT NOT NULL,
  body       TEXT NOT NULL,
  resolved   INTEGER NOT NULL,
  created_at TEXT NOT NULL
) STRICT;
`;
```

A mark is keyed on all three ids, not on the change id alone, and that is the
one design decision in this file worth arguing about.

A change id would be the obvious key: it is what survives an amend, and
"reviewed this change" is what the reviewer means. But a row on screen is not a
change, it is a *comparison* of one change's before and after versions, and
[`alignSeries`](series.md) can put the same change on two rows at once. Take a
series `[A, B]` reordered to `[B, A]`: alignment emits three rows,
`A > nothing`, `B > B`, and `nothing > A`, because a reorder is a drop and an
insert. Keyed on the change id, marking the drop would also light up the
insert, and the second mark would silently overwrite the first. Keyed on the
triple, the two rows are two comparisons, which is what they look like.

The same key is what makes a rewrite legible. A mark whose commit ids no longer
match the row is not stale data to clean up; it is the record that the reviewer
read an *earlier* version, and the frontend shows the row as changed rather
than unread.

### A side that does not exist

`A > nothing` has no after side, so one of the three key columns has no commit
id to hold. SQLite keys cannot hold that as `NULL`: in a `STRICT` table every
`PRIMARY KEY` column is implicitly `NOT NULL`, and even without `STRICT` a
`NULL` never compares equal to another `NULL`, so every insert of the same
one-sided comparison would land as a new row.

The missing side is therefore stored as the empty string and mapped back to
`null` on the way out. A commit id is never empty, so nothing else can collide
with it, and marking becomes a plain upsert: idempotent by the key, with no
read-modify-write and no transaction.

## The module

```ts
//| id: review-session
//| file: src/backend/review/session.ts
import { Database } from "bun:sqlite";
import * as z from "zod";

const Comparison = z.object({
  changeId: z.string(),
  fromCommitId: z.string().nullable(),
  toCommitId: z.string().nullable(),
});

const Mark = Comparison.extend({ seenAt: z.string() });
export type SessionMark = z.infer<typeof Mark>;

const Comment = z.object({
  id: z.string(),
  changeId: z.string(),
  path: z.string(),
  line: z.number().int(),
  commitId: z.string(),
  body: z.string(),
  resolved: z.boolean(),
  createdAt: z.string(),
});
export type SessionComment = z.infer<typeof Comment>;

export interface SessionDocument {
  marks: SessionMark[];
  comments: SessionComment[];
}

export const SessionEdit = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("mark"), ...Mark.shape }),
  z.object({ kind: z.literal("unmark"), ...Comparison.shape }),
  z.object({ kind: z.literal("comment"), comment: Comment }),
  z.object({
    kind: z.literal("resolveComment"),
    id: z.string(),
    resolved: z.boolean(),
  }),
  z.object({ kind: z.literal("dropComment"), id: z.string() }),
]);
export type SessionEdit = z.infer<typeof SessionEdit>;
```

The handle is opened on first use and kept, keyed by path, so that a test which
repoints `DIFFY_SESSION_DB` gets its own database rather than the one a
previous test opened.

```ts
//| id: review-session

<<review-session-schema>>

const opened = new Map<string, Database>();

function database(): Database {
  const path = process.env.DIFFY_SESSION_DB ?? ".jj/diffy-session.sqlite";
  const already = opened.get(path);
  if (already !== undefined) return already;

  const db = new Database(path, { create: true });
  db.exec(SCHEMA);
  opened.set(path, db);
  return db;
}

/** A side with no commit is keyed as "", which no commit id can collide with. */
function stored(commitId: string | null): string {
  return commitId ?? "";
}

function loaded(column: string): string | null {
  return column === "" ? null : column;
}

interface MarkRow {
  change_id: string;
  from_commit_id: string;
  to_commit_id: string;
  seen_at: string;
}

interface CommentRow {
  id: string;
  change_id: string;
  path: string;
  line: number;
  commit_id: string;
  body: string;
  resolved: number;
  created_at: string;
}

export function readSession(): SessionDocument {
  const db = database();

  const marks = db
    .query<MarkRow, []>("SELECT * FROM mark ORDER BY seen_at, change_id")
    .all()
    .map((row) => ({
      changeId: row.change_id,
      fromCommitId: loaded(row.from_commit_id),
      toCommitId: loaded(row.to_commit_id),
      seenAt: row.seen_at,
    }));

  const comments = db
    .query<CommentRow, []>("SELECT * FROM comment ORDER BY created_at, id")
    .all()
    .map((row) => ({
      id: row.id,
      changeId: row.change_id,
      path: row.path,
      line: row.line,
      commitId: row.commit_id,
      body: row.body,
      resolved: row.resolved !== 0,
      createdAt: row.created_at,
    }));

  return { marks, comments };
}
```

`applyEdit` is the only writer, and each arm is a single statement, so a partial
edit is not a state the session can be left in.

```ts
//| id: review-session

export function applyEdit(edit: SessionEdit): void {
  const db = database();

  switch (edit.kind) {
    case "mark":
      db.run(
        `INSERT INTO mark (change_id, from_commit_id, to_commit_id, seen_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (change_id, from_commit_id, to_commit_id)
           DO UPDATE SET seen_at = excluded.seen_at`,
        [
          edit.changeId,
          stored(edit.fromCommitId),
          stored(edit.toCommitId),
          edit.seenAt,
        ],
      );
      return;

    case "unmark":
      db.run(
        `DELETE FROM mark
         WHERE change_id = ? AND from_commit_id = ? AND to_commit_id = ?`,
        [edit.changeId, stored(edit.fromCommitId), stored(edit.toCommitId)],
      );
      return;

    case "comment":
      db.run(
        `INSERT OR REPLACE INTO comment
           (id, change_id, path, line, commit_id, body, resolved, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          edit.comment.id,
          edit.comment.changeId,
          edit.comment.path,
          edit.comment.line,
          edit.comment.commitId,
          edit.comment.body,
          edit.comment.resolved ? 1 : 0,
          edit.comment.createdAt,
        ],
      );
      return;

    case "resolveComment":
      db.run("UPDATE comment SET resolved = ? WHERE id = ?", [
        edit.resolved ? 1 : 0,
        edit.id,
      ]);
      return;

    case "dropComment":
      db.run("DELETE FROM comment WHERE id = ?", [edit.id]);
      return;
  }
}
```

## Test

Every test gets an empty database of its own, from a tmpdir, which is cheaper
than a truncate and rules out one test reading another's marks.

```ts
//| id: review-session-test
//| file: src/backend/review/session.test.ts
import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyEdit,
  readSession,
  type SessionComment,
  type SessionMark,
} from "./session";

const comment: SessionComment = {
  id: "c1",
  changeId: "a",
  path: "src/server.ts",
  line: 12,
  commitId: "a2",
  body: "this reads backwards",
  resolved: false,
  createdAt: "2026-09-14T09:00:00.000Z",
};

function seen(mark: Partial<SessionMark> = {}): SessionMark {
  return {
    changeId: "a",
    fromCommitId: "a1",
    toCommitId: "a2",
    seenAt: "2026-09-14T09:00:00.000Z",
    ...mark,
  };
}

beforeEach(() => {
  process.env.DIFFY_SESSION_DB = join(
    mkdtempSync(join(tmpdir(), "diffy-session-")),
    "session.sqlite",
  );
});

describe("readSession", () => {
  test("starts empty", () => {
    // arrange
    // act
    // assert
    expect(readSession()).toEqual({ marks: [], comments: [] });
  });
});

describe("applyEdit", () => {
  test("stores a mark", () => {
    // arrange
    // act
    applyEdit({ kind: "mark", ...seen() });

    // assert
    expect(readSession().marks).toEqual([seen()]);
  });

  test("stores a mark for a comparison with only one side", () => {
    // arrange
    const dropped = seen({ toCommitId: null });

    // act
    applyEdit({ kind: "mark", ...dropped });

    // assert
    expect(readSession().marks).toEqual([dropped]);
  });

  test("leaves one mark when the same comparison is marked twice", () => {
    // arrange
    applyEdit({ kind: "mark", ...seen() });

    // act
    applyEdit({
      kind: "mark",
      ...seen({ seenAt: "2026-09-15T09:00:00.000Z" }),
    });

    // assert
    expect(readSession().marks).toEqual([
      seen({ seenAt: "2026-09-15T09:00:00.000Z" }),
    ]);
  });

  test("keeps a mark per comparison when one change occupies two rows", () => {
    // arrange
    const dropped = seen({ toCommitId: null });
    const inserted = seen({ fromCommitId: null, toCommitId: "a2" });

    // act
    applyEdit({ kind: "mark", ...dropped });
    applyEdit({ kind: "mark", ...inserted });

    // assert
    expect(readSession().marks).toHaveLength(2);
  });

  test("unmarks only the comparison it names", () => {
    // arrange
    const dropped = seen({ toCommitId: null });
    applyEdit({ kind: "mark", ...seen() });
    applyEdit({ kind: "mark", ...dropped });

    // act
    applyEdit({
      kind: "unmark",
      changeId: dropped.changeId,
      fromCommitId: dropped.fromCommitId,
      toCommitId: dropped.toCommitId,
    });

    // assert
    expect(readSession().marks).toEqual([seen()]);
  });

  test("stores a comment", () => {
    // arrange
    // act
    applyEdit({ kind: "comment", comment });

    // assert
    expect(readSession().comments).toEqual([comment]);
  });

  test("resolves a comment", () => {
    // arrange
    applyEdit({ kind: "comment", comment });

    // act
    applyEdit({ kind: "resolveComment", id: comment.id, resolved: true });

    // assert
    expect(readSession().comments).toEqual([{ ...comment, resolved: true }]);
  });

  test("drops a comment", () => {
    // arrange
    applyEdit({ kind: "comment", comment });

    // act
    applyEdit({ kind: "dropComment", id: comment.id });

    // assert
    expect(readSession().comments).toEqual([]);
  });
});
```
