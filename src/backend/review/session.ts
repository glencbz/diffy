// ~/~ begin <<docs/architecture/backend/review.md#review-session>>[init]
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
// ~/~ end
// ~/~ begin <<docs/architecture/backend/review.md#review-session>>[1]

// ~/~ begin <<docs/architecture/backend/review.md#review-session-schema>>[init]
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
// ~/~ end

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
// ~/~ end
// ~/~ begin <<docs/architecture/backend/review.md#review-session>>[2]

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
// ~/~ end
