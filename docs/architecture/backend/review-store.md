# Review store

The [review document](../frontend/review.md#review-state) lives on the server,
so that anything able to reach the server can read and write it: a second
browser, a second tab, or an agent. The
[direction](../../direction.md#the-review-document-moves-to-the-server) sets
out why it moved out of the browser.

## One file per repository

The document is a SQLite file in diffy's data directory,
`$XDG_DATA_HOME/diffy/`, or `~/.local/share/diffy/` when that variable is
unset, one per repository, read and written with `bun:sqlite`. It stays out of
the repository's own directories because those belong to jj and git, and a
file in the working copy would be snapshotted into whatever change is checked
out.

A repository is named by [the real path of its store](jj.md#finding-the-repository),
which every workspace of it shares, so every workspace's server reads and
writes the same file. The file's name is the directory the repository was
made in, for whoever lists the data directory, and a hash of the store's
path, so two repositories made in directories of the same name keep apart.

## The document as one row

The file holds one row, the whole document as JSON, with a revision number
beside it. Every change is a
[command](../frontend/review.md#review-state), and the store applies it with
the same `applyCommand` the browser uses, inside a transaction that reads the
row, applies the command, and writes the row back. The model's function is
then the only statement of what a command does.

A table per kind of thing, one for marks and one for comments, was the other
shape. It would let SQL answer questions about one kind without reading the
rest, but every command would need a second implementation written in SQL
next to the model's, and the two could disagree about what a command means.
The document is small enough to read whole on every write.

Several servers write the one file, since each workspace runs its own. The
transaction takes SQLite's write lock before it reads, so two servers
applying a command at once apply one after the other, and each reads what
the other wrote. A reader waits for a writer rather than failing, for up to
five seconds, since write-ahead logging lets reads go on beside a write and
only a second writer has to wait.

The revision counts writes. Two answers to two commands sent close together
can arrive in either order, and a browser holding the older one would show
the second command undone. The revision lets it keep whichever answer is
newer.

A row that does not parse is an error, not an empty document. The browser's
store fell back to an empty document because the next write would at worst
store what the reader did afterwards. Here the next write would replace every
reader's marks and comments, so the store refuses to read or write until the
row is dealt with, and the server answers with a 500.

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
    apply: (command) => apply.immediate(command),
    revision: () => selectRevision.get()?.revision ?? 0,
  };
}
```

## Telling screens about changes

An open screen learns that the document changed without asking over and
over. The server keeps a WebSocket to each screen, and says the new revision
whenever the document moves on, and the screen reads the document again. An
agent's comment then reaches the reader's open screen without a reload.

A write can come from this server or from another one, since every
workspace's server writes the same file, and a server hears nothing of the
other's writes. `watchReview` asks the store for its revision twice a second
and passes on each new one, which finds both kinds of write the same way. The
query reads one integer and parses nothing. Publishing straight after this
server's own writes would reach its screens half a second sooner, but it
would be a second path to keep right beside the one other servers' writes
need anyway, and the screen that wrote already has the answer to its own
command.

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

The store's tests open it on a file in a fresh temporary directory, since two
stores sharing one file is one of the things they check, and an in-memory
database cannot be opened twice.

```ts
//| id: backend-review-store-test
//| file: src/backend/review/store.test.ts

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
```
