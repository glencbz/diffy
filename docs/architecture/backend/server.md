# Backend

## Web server

As with all our components, we add a just rule to run the backend:

```just
#| id: just-bun
# Run the app
@run port="3000":
  PORT={{port}} bun run src/server.ts

```

The entrypoint is a single ts file with a web server. Route handlers and the
route table are exported so tests can call them directly; `Bun.serve` only runs
when the file is the process entrypoint (`import.meta.main`).

`Bun.serve` is given no port, which makes it read `$PORT` and fall back to 3000.
Every workspace serves the repo it sits in, so several of them run side by side
during review, each on a port of its own.

`just run` leaves `NODE_ENV` alone, so Bun serves in dev mode with hot reload,
which is what a frontend change wants locally. Dev mode also checks the `Host`
header against the address it is listening on, so it cannot be read through a
proxy; serving a workspace for review therefore sets `NODE_ENV=production`. Both
modes are worth having, so the choice sits with whoever starts the server rather
than being fixed here. See [serving](../../devtools/serving.md).

`jjJson` runs a handler body and turns a rejected revset or operation id
(`JjError`) into a 400 carrying jj's own message; anything else is a genuine
fault and propagates as a 500. Every jj-backed route goes through it, so that
mapping exists in one place instead of being repeated per handler.

```ts
//| id: backend-server
//| file: src/server.ts

import {
  JjError,
  type JjFileDiff,
  type JjLogEntry,
  jjCommits,
  jjDiff,
  jjInterdiff,
  jjLog,
  jjOpLog,
} from "./backend/commit/jj";
import { type AlignedPair, alignSeries } from "./backend/commit/series";
import { applyEdit, readSession, SessionEdit } from "./backend/review/session";
import index from "./frontend/index.html";

/** Run a jj-backed handler body; a rejected revset/operation becomes a 400. */
async function jjJson(build: () => Promise<unknown>): Promise<Response> {
  try {
    return Response.json(await build());
  } catch (error) {
    if (error instanceof JjError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}

export function handleLog(req: Request): Promise<Response> {
  const atOperation = new URL(req.url).searchParams.get("op") ?? undefined;
  return jjJson(() => jjLog({ atOperation }));
}

export function handleOperations(): Promise<Response> {
  return jjJson(() => jjOpLog({ limit: 200 }));
}

export function handleDiff(req: Request): Promise<Response> {
  const params = new URL(req.url).searchParams;
  const revision = params.get("rev") ?? "@";
  const atOperation = params.get("op") ?? undefined;
  return jjJson(async () => ({
    revision,
    files: await jjDiff({ revision, atOperation }),
  }));
}
```

`/api/interdiff` takes any number of `from` and `to` commit ids, each side in
`jj log` order, and answers with one row per lined-up pair. Commit ids rather
than change ids or revsets, because the two sides are routinely picked out of
different operations and only a commit id means the same thing in both.

The two sides need not be the same length, and neither has to be a single
commit. [`alignSeries`](series.md) decides which commit faces which; this
handler only turns each of its rows into a diff. A row with both sides is an
interdiff. A row with one side is a commit that was added to or dropped from
the series, and its own diff is the only honest thing to show for it. That
last rule is also what makes `from` empty, `to` a single commit reduce to
"pick a commit, read its diff", the v0 behaviour, with no separate endpoint.

Rows are built concurrently. Each one is a separate `jj` process, and jj
serialises nothing that matters for a read, so a ten-commit series costs about
what one commit costs.

Asking for no commits at all is the one case with no answer, and it is a 400.

```ts
//| id: backend-server

export async function handleInterdiff(req: Request): Promise<Response> {
  const params = new URL(req.url).searchParams;
  const from = params.getAll("from");
  const to = params.getAll("to");

  if (from.length === 0 && to.length === 0) {
    return Response.json(
      { error: "interdiff needs at least one commit" },
      { status: 400 },
    );
  }

  return jjJson(async () => {
    const commits = await jjCommits([...from, ...to]);
    const series = (ids: string[]): JjLogEntry[] =>
      ids.flatMap((id) => {
        const commit = commits.get(id);
        return commit === undefined ? [] : [commit];
      });

    return {
      rows: await Promise.all(
        alignSeries(series(from), series(to)).map(async (pair) => ({
          ...pair,
          files: await pairFiles(pair),
        })),
      ),
    };
  });
}

/** A paired row is an interdiff; a lone commit is just its own diff. */
function pairFiles(pair: AlignedPair<JjLogEntry>): Promise<JjFileDiff[]> {
  if (pair.from !== null && pair.to !== null) {
    return jjInterdiff({ from: pair.from.commitId, to: pair.to.commitId });
  }

  const lone = pair.from ?? pair.to;
  return lone === null
    ? Promise.resolve([])
    : jjDiff({ revision: lone.commitId });
}
```

## Session routes

[`/api/session`](review.md) sits next to `/api/interdiff` but answers from
SQLite, not `jj`. `jjJson` exists to turn a rejected revset or operation id
into a 400; these two handlers never run a jj process, so there is no
`JjError` for it to catch, and going through it would just be a `try` with
nothing to catch. They parse and answer for themselves instead, in the same
shape.

`handleSession` can return a bare `Response` rather than a `Promise`, because
`readSession` is synchronous — `bun:sqlite` is synchronous — and `Bun.serve`
takes either. `handleSessionEdit` reads the body against `SessionEdit` and
reports a bad shape exactly the way `jjJson` reports a bad revset: 400, an
`error` string, nothing more specific. The client already knows what it sent;
it does not need field-by-field detail to recover, only to know the send
failed.

```ts
//| id: backend-server

export function handleSession(): Response {
  return Response.json(readSession());
}

export async function handleSessionEdit(req: Request): Promise<Response> {
  const parsed = SessionEdit.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json({ error: parsed.error.message }, { status: 400 });
  }

  applyEdit(parsed.data);
  return new Response(null, { status: 204 });
}
```

The route table is the list of handlers the server exposes.

```ts
//| id: backend-server

export const routes = {
  "/": index,
  "/api/log": handleLog,
  "/api/operations": handleOperations,
  "/api/diff": handleDiff,
  "/api/interdiff": handleInterdiff,
  "/api/session": { GET: handleSession, POST: handleSessionEdit },
};

if (import.meta.main) {
  const server = Bun.serve({ routes });
  console.log(`Listening on ${server.url}`);
}
```

### Route tests

Each handler is a plain `Request` → `Response` function, so the tests call it
without binding a port.

```ts
//| id: backend-server-test
//| file: src/server.test.ts
import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { jjLog } from "./backend/commit/jj";
import {
  handleDiff,
  handleInterdiff,
  handleLog,
  handleOperations,
  handleSession,
  handleSessionEdit,
} from "./server";

/** The commit id of the single commit `revset` names. */
async function commitId(revset: string): Promise<string> {
  const [entry] = await jjLog({ revset, limit: 1 });
  if (entry === undefined) throw new Error(`no commit matches ${revset}`);
  return entry.commitId;
}

beforeEach(() => {
  process.env.DIFFY_SESSION_DB = join(
    mkdtempSync(join(tmpdir(), "diffy-server-session-")),
    "session.sqlite",
  );
});

describe("handleLog", () => {
  test("returns the commit log as an array", async () => {
    // arrange
    // act
    const res = await handleLog(new Request("http://test/api/log"));
    const body = (await res.json()) as unknown[];

    // assert
    expect(res.status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
  });

  test("reports an unknown operation as 400 with jj's message", async () => {
    // arrange
    // act
    const res = await handleLog(
      new Request("http://test/api/log?op=no-such-op-xyz"),
    );
    const body = (await res.json()) as { error: string };

    // assert
    expect(res.status).toBe(400);
    expect(typeof body.error).toBe("string");
  });
});

describe("handleOperations", () => {
  test("returns the operation log as a non-empty array", async () => {
    // arrange
    // act
    const res = await handleOperations();
    const body = (await res.json()) as unknown[];

    // assert
    expect(res.status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
  });
});

describe("handleDiff", () => {
  test("returns the revision and its file diffs", async () => {
    // arrange
    // act
    const res = await handleDiff(
      new Request("http://test/api/diff?rev=root()%2B"),
    );

    // assert
    expect(res.status).toBe(200);
    const body = (await res.json()) as { revision: string; files: unknown[] };
    expect(body.revision).toBe("root()+");
    expect(body.files.length).toBeGreaterThan(0);
  });

  test("defaults the revision to @", async () => {
    // arrange
    // act
    const res = await handleDiff(new Request("http://test/api/diff"));
    const body = (await res.json()) as { revision: string };

    // assert
    expect(res.status).toBe(200);
    expect(body.revision).toBe("@");
  });

  test("reports an unresolvable revision as 400 with jj's message", async () => {
    // arrange
    // act
    const res = await handleDiff(
      new Request("http://test/api/diff?rev=no-such-xyz"),
    );
    const body = (await res.json()) as { error: string };

    // assert
    expect(res.status).toBe(400);
    expect(body.error).toMatch(/doesn't exist/);
  });
});

describe("handleInterdiff", () => {
  function request(params: [string, string][]): Request {
    return new Request(
      `http://test/api/interdiff?${new URLSearchParams(params)}`,
    );
  }

  async function rowsFor(params: [string, string][]) {
    const res = await handleInterdiff(request(params));
    const body = (await res.json()) as {
      rows: {
        from: { commitId: string } | null;
        to: { commitId: string } | null;
        files: { status: string }[];
      }[];
    };
    expect(res.status).toBe(200);
    return body.rows;
  }

  test("pairs one commit against another", async () => {
    // arrange
    const from = await commitId("root()+");
    const to = await commitId("root()++");

    // act
    const rows = await rowsFor([
      ["from", from],
      ["to", to],
    ]);

    // assert
    expect(rows).toHaveLength(1);
    expect(rows[0]?.from?.commitId).toBe(from);
    expect(rows[0]?.to?.commitId).toBe(to);
    expect(rows[0]?.files.length).toBeGreaterThan(0);
  });

  test("lines up a series against itself, one row per commit", async () => {
    // arrange
    const ids = (await jjLog({ revset: "root()+::", limit: 3 })).map(
      (entry) => entry.commitId,
    );
    const params: [string, string][] = [
      ...ids.map((id): [string, string] => ["from", id]),
      ...ids.map((id): [string, string] => ["to", id]),
    ];

    // act
    const rows = await rowsFor(params);

    // assert
    expect(rows).toHaveLength(ids.length);
    for (const row of rows) {
      expect(row.from?.commitId).toBe(row.to?.commitId as string);
      expect(row.files).toEqual([]);
    }
  });

  test("gives a commit with no opposite number its own diff", async () => {
    // arrange
    const to = await commitId("root()+");

    // act
    const rows = await rowsFor([["to", to]]);

    // assert
    expect(rows).toHaveLength(1);
    expect(rows[0]?.from).toBeNull();
    expect(rows[0]?.to?.commitId).toBe(to);
    for (const file of rows[0]?.files ?? []) {
      expect(file.status).toBe("added");
    }
  });

  test("reports a request with no commits as 400", async () => {
    // arrange
    // act
    const res = await handleInterdiff(request([]));
    const body = (await res.json()) as { error: string };

    // assert
    expect(res.status).toBe(400);
    expect(body.error).toMatch(/at least one commit/);
  });

  test("reports an unresolvable commit as 400 with jj's message", async () => {
    // arrange
    // act
    const res = await handleInterdiff(
      request([
        ["from", "no-such-xyz"],
        ["to", "@"],
      ]),
    );
    const body = (await res.json()) as { error: string };

    // assert
    expect(res.status).toBe(400);
    expect(body.error).toMatch(/doesn't exist/);
  });

  test("keeps interdiff rows free of review fields", async () => {
    // arrange
    const to = await commitId("root()+");

    // act
    const rows = await rowsFor([["to", to]]);

    // assert
    expect(Object.keys(rows[0] ?? {}).sort()).toEqual(["files", "from", "to"]);
  });
});

describe("handleSession", () => {
  test("starts empty", async () => {
    // arrange
    // act
    const res = handleSession();
    const body = await res.json();

    // assert
    expect(res.status).toBe(200);
    expect(body).toEqual({ marks: [], comments: [] });
  });
});

describe("handleSessionEdit", () => {
  test("stores a mark and hands it back on the next GET", async () => {
    // arrange
    const mark = {
      changeId: "a",
      fromCommitId: "a1",
      toCommitId: "a2",
      seenAt: "2026-09-14T09:00:00.000Z",
    };

    // act
    const res = await handleSessionEdit(
      new Request("http://test/api/session", {
        method: "POST",
        body: JSON.stringify({ kind: "mark", ...mark }),
      }),
    );
    const body = await handleSession().json();

    // assert
    expect(res.status).toBe(204);
    expect(body).toEqual({ marks: [mark], comments: [] });
  });

  test("reports a malformed body as 400 with a string error", async () => {
    // arrange
    // act
    const res = await handleSessionEdit(
      new Request("http://test/api/session", {
        method: "POST",
        body: JSON.stringify({ kind: "no-such-kind" }),
      }),
    );
    const body = (await res.json()) as { error: string };

    // assert
    expect(res.status).toBe(400);
    expect(typeof body.error).toBe("string");
  });
});
```

## Quality

### Testing

`bun test` is our test runner. Having fewer deps is nice.

```just
#| id: just-bun-test
# Run tests
@test:
  bun test
```

### Typechecking

Bun transpiles TS by stripping types, it doesn't check them, so we still
need `tsc --noEmit` (config in `tsconfig.json`) as a separate check.

```just
#| id: just-bun-typecheck
# Typecheck without emitting
@typecheck:
  bunx tsc --noEmit
```

### Linting & formatting

[Biome](https://biomejs.dev/) is our linter/formatter. It's faster and easier than 
ESLint + Prettier. We used the default `bunx biome init`.

```just
#| id: just-biome
# Lint and check formatting/import order
@lint:
  bunx biome check .

# Lint and apply automatic fixes
@lint-fix:
  bunx biome check . --fix

# Format code in place
@format:
  bunx biome format --write .
```
