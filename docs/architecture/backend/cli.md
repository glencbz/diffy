# Command line

`diffy`, run from inside a jj repository, serves that repository. Every route
shells out to `jj` or `git` in the process's working directory, so the
directory it starts in is the only thing that says which repository it reads.
`src/cli.ts` is the one process entrypoint: `just run` starts the server
through it, and [the Nix package](../../devtools/nix.md#installing-diffy)
compiles it into the installed `diffy` executable. `NODE_ENV` still picks dev or production mode, so the same
entrypoint serves both.

```sh
cd ~/src/some-repo
diffy              # serves some-repo on the first free port from 3000
diffy --port 4100  # serves it on 4100, or fails if 4100 is taken
```

Reading the command line is a pure function from `argv` to a `Command`, so it
is tested without binding a port or running jj. A port the caller typed and a
port nobody asked for behave differently once the port turns out to be busy,
so they are two variants rather than a number that might be missing.

```ts
//| id: cli-module
//| file: src/cli.ts
import { parseArgs } from "node:util";
import { $ } from "bun";
import { routes } from "./server";

const USAGE = "usage: diffy [--port <n>]";

export type PortChoice =
  | { kind: "given"; port: number }
  | { kind: "first-free"; from: number };

export type Command =
  | { kind: "serve"; port: PortChoice }
  | { kind: "help" }
  | { kind: "usage-error"; reason: string };

export function parseCommand(argv: string[]): Command {
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

A port given by name is held to, since whoever typed it chose it for a
reason, and a busy one ends the run. Without one, diffy walks up from 3000,
because serving several repositories side by side is routine and each only
needs a port of its own. `Bun.serve` reports a busy port by throwing an error
whose `code` is `EADDRINUSE`.

`jj root` runs before anything binds. Outside a repository every route would
fail, so diffy stops with jj's own explanation instead of serving a page that
cannot load. Inside one, it answers with the root to print, which tells a
reader who started diffy from a subdirectory which repository they got.

```ts
//| id: cli-module

function fail(status: number, message: string): never {
  console.error(`diffy: ${message}`);
  process.exit(status);
}

function listen(choice: PortChoice): Bun.Server<undefined> {
  const first = choice.kind === "given" ? choice.port : choice.from;
  for (let port = first; ; port++) {
    try {
      return Bun.serve({ port, routes });
    } catch (error) {
      if ((error as { code?: unknown }).code !== "EADDRINUSE") throw error;
      if (choice.kind === "given") fail(1, `port ${port} is in use`);
    }
  }
}

async function serve(choice: PortChoice): Promise<void> {
  const root = await $`jj root`.quiet().nothrow();
  if (root.exitCode !== 0) fail(1, root.stderr.toString().trim());

  const server = listen(choice);
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
  }
}
```

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

test("--help asks for the usage", () => {
  expect(parseCommand(["--help"])).toEqual({ kind: "help" });
});
```
