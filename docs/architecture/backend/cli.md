# Command line

`diffy` serves one jj repository at a time: every route shells out to `jj` or
`git` in the working directory, and the reader can
[switch it from the browser](repos.md). `src/cli.ts` is the one entrypoint for
both `just run` and the
[installed executable](../../devtools/nix.md#installing-diffy).

```sh
cd ~/src/some-repo
diffy              # serves some-repo on this user's port, and opens it
cd ~/src/other
diffy              # switches the running diffy to other, and opens it
diffy --no-open    # the same without the browser
diffy --port 4100  # a second server on 4100, or fails if 4100 is taken
diffy ~/src/third  # serves third, from anywhere
cd ~/Downloads
diffy              # serves the repository opened most recently
diffy mcp          # the agent's end of MCP, for Claude Code to start
```

Claude Code is pointed at diffy once per user:

```sh
claude mcp add --scope user diffy -- diffy mcp
```

```ts
//| id: cli-module
//| file: src/cli.ts
import { spawn } from "node:child_process";
import { openSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { bridge } from "./backend/agent/bridge";
import { difftDirectories } from "./backend/commit/difft";
import {
  findServer,
  probe,
  type RunningServer,
  rollPort,
  serverFilePath,
  storedPort,
  storePort,
} from "./backend/instance/instance";
import {
  probeRepo,
  RecentRepos,
  ServedRepo,
  type Start,
  startingRepo,
} from "./backend/repo/repos";
import { REVIEW_TOPIC, reviewSocket, routes } from "./server";

const USAGE = `usage: diffy [<path>] [--port <n>] [--no-open]
       diffy mcp [--url <server>]`;

// A typed port is held to and a busy one ends the run; otherwise diffy is
// this user's one server, on the port it keeps across runs.
export type PortChoice = { kind: "given"; port: number } | { kind: "sticky" };

export type Command =
  | { kind: "serve"; path?: string; port: PortChoice; open: boolean }
  | { kind: "mcp"; url?: string }
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
  if (argv[0] === "mcp") return parseMcp(argv.slice(1));

  let values: { port?: string; help?: boolean; "no-open"?: boolean };
  let positionals: string[];
  try {
    ({ values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        port: { type: "string", short: "p" },
        "no-open": { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    }));
  } catch (error) {
    return { kind: "usage-error", reason: (error as Error).message };
  }

  if (values.help) return { kind: "help" };
  if (positionals.length > 1) {
    return { kind: "usage-error", reason: "give at most one path" };
  }
  const [path] = positionals;
  const at = path === undefined ? {} : { path };
  const open = !values["no-open"];
  if (values.port === undefined) {
    return { kind: "serve", ...at, port: { kind: "sticky" }, open };
  }
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { kind: "usage-error", reason: `not a port: ${values.port}` };
  }
  return { kind: "serve", ...at, port: { kind: "given", port }, open };
}

function parseMcp(argv: string[]): Command {
  let url: string | undefined;
  try {
    ({
      values: { url },
    } = parseArgs({ args: argv, options: { url: { type: "string" } } }));
  } catch (error) {
    return { kind: "usage-error", reason: (error as Error).message };
  }
  if (url === undefined) return { kind: "mcp" };
  return URL.canParse(url)
    ? { kind: "mcp", url }
    : { kind: "usage-error", reason: `not a URL: ${url}` };
}
```

## The sticky port

A run without `--port` first looks for [this user's server](instance.md). If
one is up, the run hands off to it and exits: it switches that server to the
repository asked for and opens the browser there, so running `diffy` again is
how a reader gets back to the page whose port they never learned. Otherwise
it binds the stored port, or draws one, and stores what it bound.

The port can be busy when the run binds it, because another `diffy` started a
moment earlier and is not answering yet, or because another program took it.
The run waits briefly for diffy to answer there and hands off if it does, and
only draws a new port when it does not. Drawing at once would leave two
servers, each on a port of its own, and only one of them in the state file.

`--port` runs never read or write the state file. They are the way to serve a
second repository beside the first, and the dev setup's way to serve one
workspace per port.

A repository the run fell back on from the recent list does not switch a
running server: that server is already showing a repository, and a fallback
is not a choice the reader made.

```ts
//| id: cli-module

function fail(status: number, message: string): never {
  console.error(`diffy: ${message}`);
  process.exit(status);
}

type Bind = (port: number) => Bun.Server<undefined> | null;

type Listening =
  | { kind: "bound"; server: Bun.Server<undefined> }
  | { kind: "running"; running: RunningServer };

async function listenSticky(bind: Bind): Promise<Listening> {
  let port = (await storedPort()) ?? rollPort();
  for (let draws = 0; draws < 20; draws++) {
    const server = bind(port);
    if (server !== null) {
      await storePort(port);
      return { kind: "bound", server };
    }
    for (let waits = 0; waits < 20; waits++) {
      const running = await probe(port);
      if (running !== null) return { kind: "running", running };
      await Bun.sleep(100);
    }
    port = rollPort();
  }
  fail(1, "found no free port");
}

async function handOff(running: RunningServer, start: Start, open: boolean) {
  if (
    start.kind === "open" &&
    start.startedOutside === null &&
    start.root !== running.current
  ) {
    const res = await fetch(new URL("/api/repo", running.url), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: start.root }),
    });
    if (!res.ok) fail(1, ((await res.json()) as { error: string }).error);
    console.log(`diffy at ${running.url} now serves ${start.root}`);
  } else {
    console.log(
      `diffy is serving ${running.current ?? "no repository"} at ${running.url}`,
    );
  }
  if (open) openBrowser(running.url);
}

async function serve(
  path: string | undefined,
  choice: PortChoice,
  openAsked: boolean,
) {
  // A run started by a script, a background start among them, has nobody
  // at a browser to open it for.
  const open = openAsked && process.stdout.isTTY === true;
  const recent = await RecentRepos.at();
  const start = await startingRepo(path, process.cwd(), await recent.read());
  if (start.kind === "fail") fail(1, start.reason);
  if (choice.kind === "sticky") {
    const running = await findServer();
    if (running !== null) return handOff(running, start, open);
  }

  let server: Bun.Server<undefined> | null = null;
  const served = new ServedRepo(recent, (revision) =>
    server?.publish(REVIEW_TOPIC, JSON.stringify({ revision })),
  );
  if (start.kind === "open") {
    await served.open(start.root, start.startedOutside);
  } else {
    served.startedOutside = start.startedOutside;
  }
  const bind: Bind = (port) => {
    try {
      return Bun.serve({
        port,
        routes: routes(served, recent),
        websocket: reviewSocket,
      });
    } catch (error) {
      if ((error as { code?: unknown }).code !== "EADDRINUSE") throw error;
      return null;
    }
  };
  if (choice.kind === "given") {
    server = bind(choice.port) ?? fail(1, `port ${choice.port} is in use`);
  } else {
    const listening = await listenSticky(bind);
    if (listening.kind === "running") {
      await handOff(listening.running, start, open);
      process.exit(0);
    }
    server = listening.server;
  }
  // The printed root tells a reader started from a subdirectory, or from
  // outside any repository, which repository they got.
  console.log(
    start.kind === "open"
      ? `diffy serving ${start.root} at ${server.url}`
      : `diffy at ${server.url}: ${start.startedOutside} is not a jj repository, pick one there`,
  );
  if (open) openBrowser(server.url);
}
```

## Opening the browser

The browser opens on the served page so that nobody has to type a port. A
run with no display, as over SSH, opens nothing, and the printed URL is
what the reader has.

```ts
//| id: cli-module

function openBrowser(url: URL) {
  const opener =
    process.platform === "darwin"
      ? "open"
      : process.env.DISPLAY || process.env.WAYLAND_DISPLAY
        ? "xdg-open"
        : null;
  if (opener === null) return;
  spawn(opener, [url.href], { detached: true, stdio: "ignore" })
    // A machine without the opener still has the printed URL.
    .on("error", () => {})
    .unref();
}
```

## `diffy mcp`

The [bridge](agents.md#the-stdio-bridge) runs on the agent's stdin and
stdout. It finds this user's server, and starts one when none is up, detached
so that it outlives the agent session and logging beside the state file. It
waits for the new server to answer, since the agent's first message is
already waiting. `--url` names a server to use instead, such as one started
with `--port`, and then nothing is found or started.

```ts
//| id: cli-module

async function startInBackground(): Promise<RunningServer> {
  const log = join(dirname(serverFilePath()), "server.log");
  await mkdir(dirname(log), { recursive: true });
  const out = openSync(log, "a");
  // A compiled diffy is its own executable; under `bun run` the script is
  // an argument.
  const script = Bun.main.startsWith("/$bunfs/") ? [] : [Bun.main];
  spawn(process.execPath, [...script, "--no-open"], {
    detached: true,
    stdio: ["ignore", out, out],
  }).unref();
  for (let tries = 0; tries < 100; tries++) {
    await Bun.sleep(100);
    const running = await findServer();
    if (running !== null) return running;
  }
  throw new Error(`diffy did not start; its log is ${log}`);
}

async function mcp(url: string | undefined) {
  const here = await probeRepo(process.cwd());
  const given = url === undefined ? null : new URL("/mcp", url);
  await bridge(console, (line) => process.stdout.write(`${line}\n`), {
    workspace: here.kind === "jj" ? here.root : null,
    find: async () =>
      given ??
      new URL(
        "/mcp",
        ((await findServer()) ?? (await startInBackground())).url,
      ),
  });
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
      await serve(command.path, command.port, command.open);
      break;
    case "mcp":
      await mcp(command.url);
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

test("no port means this user's server, opened in the browser", () => {
  expect(parseCommand([])).toEqual({
    kind: "serve",
    port: { kind: "sticky" },
    open: true,
  });
  expect(parseCommand(["--no-open"])).toEqual({
    kind: "serve",
    port: { kind: "sticky" },
    open: false,
  });
});

test("a port given long or short is held to", () => {
  const given: Command = {
    kind: "serve",
    port: { kind: "given", port: 4100 },
    open: true,
  };
  expect(parseCommand(["--port", "4100"])).toEqual(given);
  expect(parseCommand(["-p", "4100"])).toEqual(given);
});

test("a port that is not one is a usage error", () => {
  for (const port of ["abc", "0", "65536", "80.5"]) {
    expect(parseCommand(["--port", port]).kind).toBe("usage-error");
  }
});

test("a path names the repository to serve", () => {
  expect(parseCommand(["~/src/a", "-p", "4100"])).toEqual({
    kind: "serve",
    path: "~/src/a",
    port: { kind: "given", port: 4100 },
    open: true,
  });
});

test("unknown flags and a second path are usage errors", () => {
  expect(parseCommand(["--bogus"]).kind).toBe("usage-error");
  expect(parseCommand(["a", "b"]).kind).toBe("usage-error");
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

test("mcp takes an optional server URL", () => {
  expect(parseCommand(["mcp"])).toEqual({ kind: "mcp" });
  expect(parseCommand(["mcp", "--url", "http://localhost:4000"])).toEqual({
    kind: "mcp",
    url: "http://localhost:4000",
  });
  expect(parseCommand(["mcp", "--url", "nope"]).kind).toBe("usage-error");
  expect(parseCommand(["mcp", "--port", "1"]).kind).toBe("usage-error");
});

test("--help asks for the usage", () => {
  expect(parseCommand(["--help"])).toEqual({ kind: "help" });
});
```
