// ~/~ begin <<docs/architecture/backend/review-store.md#backend-review-store>>[init]
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
// ~/~ end
// ~/~ begin <<docs/architecture/backend/review-store.md#backend-review-store>>[1]

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
// ~/~ end
