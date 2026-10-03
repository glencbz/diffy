# Review store

The [review document](../frontend/review.md#review-state) lives on the server
so a second browser, a second tab, or an agent can read and write it.

## One file per repository

One SQLite file per repository under `$XDG_DATA_HOME/diffy/`, outside the
repository because a file in the working copy would be snapshotted into
whatever change is checked out. A repository is named by
[the real path of its store](jj.md#finding-the-repository), so every workspace's
server shares the file.

## The document as one row

The file holds one row: the whole document as JSON, plus a revision. The store
applies each [command](../frontend/review.md#review-state) with the same
`applyCommand` the browser uses, so the model is the only statement of what a
command does. A table per kind of thing would let SQL query one kind alone,
but every command would need a second implementation in SQL that could
disagree with the model's. The document is small enough to read whole on
every write.

```ts
//| id: backend-review-store
//| file: src/backend/review/store.ts
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import {
  applyCommand,
  EMPTY_REVIEW,
  type ReviewCommand,
  ReviewDocument,
  type ReviewSnapshot,
} from "../../frontend/model/review";
import { jjRepoDir } from "../commit/jj";

export interface ReviewStore {
  read(): ReviewSnapshot;
  apply(command: ReviewCommand): ReviewSnapshot;
  /** The revision alone, without reading the document. */
  revision(): number;
}

/** The review store of the repository the server was started in. */
export async function reviewStorePath(
  env: Record<string, string | undefined> = process.env,
): Promise<string> {
  const repo = await jjRepoDir();
  const dataHome = env.XDG_DATA_HOME || join(homedir(), ".local", "share");
  const dir = join(dataHome, "diffy");
  await mkdir(dir, { recursive: true });
  const name = basename(dirname(dirname(repo)));
  const hash = createHash("sha256").update(repo).digest("hex").slice(0, 16);
  return join(dir, `${name}-${hash}.sqlite`);
}

export function openReviewStore(path: string): ReviewStore {
  const db = new Database(path, { create: true, strict: true });
  // Each workspace's server writes this file. WAL lets reads run beside a
  // write; a second writer waits rather than failing.
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA busy_timeout = 5000");
  db.run(
    `CREATE TABLE IF NOT EXISTS review (
       id INTEGER PRIMARY KEY CHECK (id = 1),
       revision INTEGER NOT NULL,
       document TEXT NOT NULL
     )`,
  );

  const selectRevision = db.query<{ revision: number }, []>(
    "SELECT revision FROM review WHERE id = 1",
  );
  const select = db.query<{ revision: number; document: string }, []>(
    "SELECT revision, document FROM review WHERE id = 1",
  );
  const write = db.query(
    `INSERT INTO review (id, revision, document)
     VALUES (1, $revision, $document)
     ON CONFLICT (id) DO UPDATE SET
       revision = excluded.revision, document = excluded.document`,
  );

  // A row that does not parse throws rather than reading as empty: the next
  // write would replace every reader's marks and comments.
  function read(): ReviewSnapshot {
    const row = select.get();
    if (row === null) return { revision: 0, document: EMPTY_REVIEW };
    return {
      revision: row.revision,
      document: ReviewDocument.parse(JSON.parse(row.document)),
    };
  }

  const apply = db.transaction((command: ReviewCommand): ReviewSnapshot => {
    const current = read();
    const next = {
      revision: current.revision + 1,
      document: applyCommand(current.document, command),
    };
    write.run({
      revision: next.revision,
      document: JSON.stringify(next.document),
    });
    return next;
  });

  return {
    read,
    // immediate takes the write lock before reading, so two servers applying
    // at once each see what the other wrote. The revision lets a browser
    // keep the newer of two answers that arrive out of order.
    apply: (command) => apply.immediate(command),
    revision: () => selectRevision.get()?.revision ?? 0,
  };
}
```

## Telling screens about changes

The server tells each open screen over a WebSocket when the revision moves.
Other workspaces' servers write the same file and this one hears nothing of
it, so `watchReview` polls the revision rather than publishing after its own
writes; one path covers both kinds of writer.

```ts
//| id: backend-review-store

/** Calls `publish` with each revision the store reaches, from any writer,
 *  until the returned function is called. */
export function watchReview(
  store: ReviewStore,
  publish: (revision: number) => void,
  everyMs = 500,
): () => void {
  let seen = store.revision();
  const timer = setInterval(() => {
    const revision = store.revision();
    if (revision === seen) return;
    seen = revision;
    publish(revision);
  }, everyMs);
  return () => clearInterval(timer);
}
```

## Tests

Tests use a file in a temporary directory, since an in-memory database cannot
be opened twice.

```ts
//| id: backend-review-store-test
//| file: src/backend/review/store.test.ts

import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EMPTY_REVIEW, type ReviewCommand } from "../../frontend/model/review";
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
      document: EMPTY_REVIEW,
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
```
