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
  jjCommits,
  jjDiff,
  jjInterdiff,
  jjLog,
  jjOpLog,
} from "./backend/commit/jj";
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

`/api/interdiff` takes a `from` and a `to` commit id and answers with the two
commits plus the files their changes differ in. Both are commit ids, not
change ids or revsets, because the two sides are routinely picked out of
different operations and only a commit id means the same thing in both.

Either side may be left out. A commit with nothing opposite it has nothing to
be compared against, so the honest answer is its own diff, and that is what
the handler returns. The v0 behaviour, pick a commit and read its diff, is
then just this endpoint with an empty `from`, instead of a separate screen the
UI has to switch between. Leaving out both sides is the one case with no
answer at all, and it is a 400.

```ts
//| id: backend-server

export async function handleInterdiff(req: Request): Promise<Response> {
  const params = new URL(req.url).searchParams;
  const from = params.get("from");
  const to = params.get("to");

  if (from === null && to === null) {
    return Response.json(
      { error: "interdiff needs a from or a to commit" },
      { status: 400 },
    );
  }

  return jjJson(async () => {
    const commits = await jjCommits([from, to].filter((id) => id !== null));
    const files =
      from !== null && to !== null
        ? await jjInterdiff({ from, to })
        : await jjDiff({ revision: from ?? to ?? "" });

    return {
      from: from === null ? null : (commits.get(from) ?? null),
      to: to === null ? null : (commits.get(to) ?? null),
      files,
    };
  });
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
import { describe, expect, test } from "bun:test";
import { jjLog } from "./backend/commit/jj";
import {
  handleDiff,
  handleInterdiff,
  handleLog,
  handleOperations,
} from "./server";

/** The commit id of the single commit `revset` names. */
async function commitId(revset: string): Promise<string> {
  const [entry] = await jjLog({ revset, limit: 1 });
  if (entry === undefined) throw new Error(`no commit matches ${revset}`);
  return entry.commitId;
}

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
  function request(params: Record<string, string>): Request {
    return new Request(
      `http://test/api/interdiff?${new URLSearchParams(params)}`,
    );
  }

  test("echoes both commits and the files they differ in", async () => {
    // arrange
    const from = await commitId("root()+");
    const to = await commitId("root()++");

    // act
    const res = await handleInterdiff(request({ from, to }));
    const body = (await res.json()) as {
      from: { commitId: string };
      to: { commitId: string };
      files: unknown[];
    };

    // assert
    expect(res.status).toBe(200);
    expect(body.from.commitId).toBe(from);
    expect(body.to.commitId).toBe(to);
    expect(body.files.length).toBeGreaterThan(0);
  });

  test("falls back to a commit's own diff when one side is missing", async () => {
    // arrange
    const to = await commitId("root()+");

    // act
    const res = await handleInterdiff(request({ to }));
    const body = (await res.json()) as {
      from: null;
      to: { commitId: string };
      files: { status: string }[];
    };

    // assert
    expect(res.status).toBe(200);
    expect(body.from).toBeNull();
    expect(body.to.commitId).toBe(to);
    for (const file of body.files) expect(file.status).toBe("added");
  });

  test("reports an empty request as 400", async () => {
    // arrange
    // act
    const res = await handleInterdiff(request({}));
    const body = (await res.json()) as { error: string };

    // assert
    expect(res.status).toBe(400);
    expect(body.error).toMatch(/from or a to/);
  });

  test("reports an unresolvable commit as 400 with jj's message", async () => {
    // arrange
    // act
    const res = await handleInterdiff(
      request({ from: "no-such-xyz", to: "@" }),
    );
    const body = (await res.json()) as { error: string };

    // assert
    expect(res.status).toBe(400);
    expect(body.error).toMatch(/doesn't exist/);
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
