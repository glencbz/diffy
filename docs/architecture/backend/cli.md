# Command line

`diffy`, run from inside a jj repository, serves that repository: every route
shells out to `jj` or `git` in the working directory. `src/cli.ts` is the one
entrypoint for both `just run` and the
[installed executable](../../devtools/nix.md#installing-diffy).

```sh
cd ~/src/some-repo
diffy              # serves some-repo on the first free port from 3000
diffy --port 4100  # serves it on 4100, or fails if 4100 is taken
```

```ts
//| id: cli-module
//| file: src/cli.ts
import { parseArgs } from "node:util";
import { $ } from "bun";
import { difftDirectories } from "./backend/commit/difft";
import {
  openReviewStore,
  type ReviewStore,
  reviewStorePath,
  watchReview,
} from "./backend/review/store";
import { REVIEW_TOPIC, reviewSocket, routes } from "./server";

const USAGE = "usage: diffy [--port <n>]";

// A typed port is held to and a busy one ends the run; otherwise diffy walks
// up from 3000 so several repositories can be served side by side.
export type PortChoice =
  | { kind: "given"; port: number }
  | { kind: "first-free"; from: number };

export type Command =
  | { kind: "serve"; port: PortChoice }
  | { kind: "difft"; left: string; right: string }
  | { kind: "help" }
  | { kind: "usage-error"; reason: string };

export function parseCommand(argv: string[]): Command {
  if (argv[0] === "difft") {
    const [, left, right, ...rest] = argv;
    return left === undefined || right === undefined || rest.length > 0
      ? { kind: "usage-error", reason: "difft takes two directories" }
      : { kind: "difft", left, right };
  }

  let values: { port?: string; help?: boolean };
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        port: { type: "string", short: "p" },
        help: { type: "boolean", short: "h" },
      },
    }));
  } catch (error) {
    return { kind: "usage-error", reason: (error as Error).message };
  }

  if (values.help) return { kind: "help" };
  if (values.port === undefined) {
    return { kind: "serve", port: { kind: "first-free", from: 3000 } };
  }
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { kind: "usage-error", reason: `not a port: ${values.port}` };
  }
  return { kind: "serve", port: { kind: "given", port } };
}
```

```ts
//| id: cli-module

function fail(status: number, message: string): never {
  console.error(`diffy: ${message}`);
  process.exit(status);
}

function listen(choice: PortChoice, store: ReviewStore): Bun.Server<undefined> {
  const first = choice.kind === "given" ? choice.port : choice.from;
  for (let port = first; ; port++) {
    try {
      return Bun.serve({
        port,
        routes: routes(store),
        websocket: reviewSocket,
      });
    } catch (error) {
      if ((error as { code?: unknown }).code !== "EADDRINUSE") throw error;
      if (choice.kind === "given") fail(1, `port ${port} is in use`);
    }
  }
}

async function serve(choice: PortChoice): Promise<void> {
  // Outside a repository every route would fail, so stop with jj's own
  // explanation. The printed root tells a reader started from a
  // subdirectory which repository they got.
  const root = await $`jj root`.quiet().nothrow();
  if (root.exitCode !== 0) fail(1, root.stderr.toString().trim());

  const store = openReviewStore(await reviewStorePath());
  const server = listen(choice, store);
  watchReview(store, (revision) =>
    server.publish(REVIEW_TOPIC, JSON.stringify({ revision })),
  );
  console.log(
    `diffy serving ${root.stdout.toString().trim()} at ${server.url}`,
  );
}

if (import.meta.main) {
  const command = parseCommand(Bun.argv.slice(2));
  switch (command.kind) {
    case "help":
      console.log(USAGE);
      break;
    case "usage-error":
      fail(2, `${command.reason}\n${USAGE}`);
      break;
    case "serve":
      await serve(command.port);
      break;
    case "difft":
      process.stdout.write(
        JSON.stringify(await difftDirectories(command.left, command.right)),
      );
      break;
  }
}
```

## Difftastic as jj's diff tool

`diffy difft <left> <right>` is the external diff tool jj runs for
[structural diffs](difft.md); it is left out of the usage because nobody types
it.

```ts
//| id: cli-test
//| file: src/cli.test.ts
import { expect, test } from "bun:test";
import { type Command, parseCommand } from "./cli";

test("no port means the first free one from 3000", () => {
  expect(parseCommand([])).toEqual({
    kind: "serve",
    port: { kind: "first-free", from: 3000 },
  });
});

test("a port given long or short is held to", () => {
  const given: Command = {
    kind: "serve",
    port: { kind: "given", port: 4100 },
  };
  expect(parseCommand(["--port", "4100"])).toEqual(given);
  expect(parseCommand(["-p", "4100"])).toEqual(given);
});

test("a port that is not one is a usage error", () => {
  for (const port of ["abc", "0", "65536", "80.5"]) {
    expect(parseCommand(["--port", port]).kind).toBe("usage-error");
  }
});

test("unknown flags and stray arguments are usage errors", () => {
  expect(parseCommand(["--bogus"]).kind).toBe("usage-error");
  expect(parseCommand(["somewhere"]).kind).toBe("usage-error");
});

test("difft takes exactly two directories", () => {
  expect(parseCommand(["difft", "a", "b"])).toEqual({
    kind: "difft",
    left: "a",
    right: "b",
  });
  expect(parseCommand(["difft", "a"]).kind).toBe("usage-error");
  expect(parseCommand(["difft", "a", "b", "c"]).kind).toBe("usage-error");
});

test("--help asks for the usage", () => {
  expect(parseCommand(["--help"])).toEqual({ kind: "help" });
});
```
