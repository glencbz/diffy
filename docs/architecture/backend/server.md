# Backend

## Web server

As with all our components, we add a just rule to run the backend:

```just
#| id: just-bun
# Run the app
@run:
  bun run src/server.ts

```

The entrypoint is a single ts file with a web server. Route handlers and the
route table are exported so tests can call them directly; `Bun.serve` only runs
when the file is the process entrypoint (`import.meta.main`).

Every jj-backed route shares one failure mode: the caller passed a revset jj
can't resolve. `jjJson` runs a handler body and turns that (`JjError`) into a
400 with jj's own message; anything else propagates as a 500. Both routes use
it:

- `GET /api/log` — the commit log.
- `GET /api/diff?rev=<revision>` — one revision's diff, file by file.

```ts
//| id: backend-server
//| file: src/server.ts

import { JjError, jjDiff, jjLog } from "./backend/commit/jj";
import index from "./frontend/index.html";

/** Run a jj-backed handler body; a rejected revset becomes a 400. */
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

export function handleLog(): Promise<Response> {
  return jjJson(() => jjLog());
}

export function handleDiff(req: Request): Promise<Response> {
  const revision = new URL(req.url).searchParams.get("rev") ?? "@";
  return jjJson(async () => ({
    revision,
    files: await jjDiff({ revision }),
  }));
}

export const routes = {
  "/": index,
  "/api/log": handleLog,
  "/api/diff": handleDiff,
};

if (import.meta.main) {
  const server = Bun.serve({ port: 3000, routes });
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
import { handleDiff, handleLog } from "./server";

describe("handleLog", () => {
  test("returns the commit log as an array", async () => {
    // arrange
    // act
    const res = await handleLog();
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
