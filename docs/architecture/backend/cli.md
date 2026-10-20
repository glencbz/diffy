# Command line

`diffy` shows the reader one jj repository at a time, which the reader can
[switch from the browser](repos.md), while each agent works in a repository
of its own. `src/cli.ts` is the one entrypoint for both `just run` and the
[installed executable](../../devtools/nix.md#installing-diffy). It is also the
one place that reads the environment: it builds the [host](host.md) once and
hands it to everything it starts.

```sh
diffy              # opens this user's diffy, on the repository used last
diffy .            # switches it to the repository here, and opens it
diffy ~/src/third  # switches it to third, from anywhere
diffy --no-open    # the same without the browser
diffy . --port 4100  # a second server on 4100, or fails if 4100 is taken
diffy mcp          # the agent's end of MCP, for Claude Code to start
diffy wait t       # exits when the reader submits the review t
```

Where `diffy` is typed never picks the repository. diffy is one app for the
whole machine, and a repository that followed the shell would change under
the reader every time they ran it from another folder, agents' background
starts included.

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
import { AgentListeners, waitFor } from "./backend/agent/listeners";
import { difftDirectories } from "./backend/commit/difft";
import { type Host, hostFrom } from "./backend/host/host";
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
  DefaultRepo,
  probeRepo,
  RecentRepos,
  type Start,
  startingRepo,
  Workspaces,
} from "./backend/repo/repos";
import { routes, type SocketData, sockets } from "./server";

const USAGE = `usage: diffy [<path>] [--port <n>] [--no-open]
       diffy mcp [--url <server>]
       diffy wait <review> [--url <server>]`;

// A typed port is held to and a busy one ends the run; otherwise diffy is
// this user's one server, on the port it keeps across runs.
export type PortChoice = { kind: "given"; port: number } | { kind: "sticky" };

export type Command =
  | { kind: "serve"; path?: string; port: PortChoice; open: boolean }
  | { kind: "mcp"; url?: string }
  | { kind: "wait"; review: string; url?: string }
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
  if (argv[0] === "wait") return parseWait(argv.slice(1));

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

function parseWait(argv: string[]): Command {
  let url: string | undefined;
  let positionals: string[];
  try {
    ({
      values: { url },
      positionals,
    } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: { url: { type: "string" } },
    }));
  } catch (error) {
    return { kind: "usage-error", reason: (error as Error).message };
  }
  const [review, ...rest] = positionals;
  if (review === undefined || rest.length > 0) {
    return { kind: "usage-error", reason: "wait takes one review" };
  }
  if (url === undefined) return { kind: "wait", review };
  return URL.canParse(url)
    ? { kind: "wait", review, url }
    : { kind: "usage-error", reason: `not a URL: ${url}` };
}
```

## The sticky port

A run without `--port` first looks for [this user's server](instance.md). If
one is up, the run hands off to it and exits: it switches that server to the
path given, if any, and opens the browser there, so running `diffy` again is
how a reader gets back to the page whose port they never learned. Otherwise
it binds the stored port, or draws one, and stores what it bound.

The port can be busy when the run binds it, because another `diffy` started a
moment earlier and is not answering yet, or because another program took it.
The run waits briefly for diffy to answer there and hands off if it does, and
only draws a new port when it does not. Drawing at once would leave two
servers, each on a port of its own, and only one of them in the state file.

`--port` runs never read or write the state file, and never add to the
[recent list](repos.md#the-recent-list). They are the way to serve a second
repository beside the first, and the dev setup's way to serve one workspace
per port, so what they open is not what the reader was working on.

```ts
//| id: cli-module

function fail(status: number, message: string): never {
  console.error(`diffy: ${message}`);
  process.exit(status);
}

type Bind = (port: number) => Bun.Server<SocketData> | null;

type Listening =
  | { kind: "bound"; server: Bun.Server<SocketData> }
  | { kind: "running"; running: RunningServer };

async function listenSticky(
  bind: Bind,
  serverFile: string,
): Promise<Listening> {
  let port = (await storedPort(serverFile)) ?? rollPort();
  for (let draws = 0; draws < 20; draws++) {
    const server = bind(port);
    if (server !== null) {
      await storePort(port, serverFile);
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

/** Hand a run over to the server already up. Only a path on the command
 *  line switches it; a bare `diffy` shows what it serves. */
async function handOff(
  running: RunningServer,
  start: Start,
  given: boolean,
  open: boolean,
) {
  if (given && start.kind === "open" && start.root !== running.current) {
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
  host: Host,
  path: string | undefined,
  choice: PortChoice,
  openAsked: boolean,
) {
  // A run started by a script, a background start among them, has nobody
  // at a browser to open it for.
  const open = openAsked && process.stdout.isTTY === true;
  const serverFile = serverFilePath(host.stateDir);
  const recent = RecentRepos.in(host.dataDir);
  const start = await startingRepo(path, await recent.read(), (each) =>
    probeRepo(each, host.home),
  );
  if (start.kind === "fail") fail(1, start.reason);
  if (choice.kind === "sticky") {
    const running = await findServer(serverFile);
    if (running !== null) {
      return handOff(running, start, path !== undefined, open);
    }
  }

  let server: Bun.Server<SocketData> | null = null;
  const listeners = new AgentListeners();
  // A server on a port of its own is a side server, such as a preview, and
  // what it opens is not what the reader was last working on.
  const defaultRepo = new DefaultRepo(
    host,
    choice.kind === "sticky" ? recent : null,
  );
  if (start.kind === "open") await defaultRepo.open(start.root);
  const workspaces = new Workspaces(host, (topic, revision) =>
    server?.publish(topic, JSON.stringify({ revision })),
  );
  const bind: Bind = (port) => {
    try {
      return Bun.serve({
        port,
        routes: routes(host, defaultRepo, recent, workspaces, listeners),
        websocket: sockets(listeners),
      });
    } catch (error) {
      if ((error as { code?: unknown }).code !== "EADDRINUSE") throw error;
      return null;
    }
  };
  if (choice.kind === "given") {
    server = bind(choice.port) ?? fail(1, `port ${choice.port} is in use`);
  } else {
    const listening = await listenSticky(bind, serverFile);
    if (listening.kind === "running") {
      await handOff(listening.running, start, path !== undefined, open);
      process.exit(0);
    }
    server = listening.server;
  }
  // The printed root tells a reader started from a subdirectory, or from
  // outside any repository, which repository they got.
  console.log(
    start.kind === "open"
      ? `diffy serving ${start.root} at ${server.url}`
      : `diffy at ${server.url}: no repository yet, pick one there`,
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

async function startInBackground(
  [command, ...args]: string[],
  serverFile: string,
): Promise<RunningServer> {
  const log = join(dirname(serverFile), "server.log");
  await mkdir(dirname(log), { recursive: true });
  const out = openSync(log, "a");
  spawn(command as string, [...args, "--no-open"], {
    detached: true,
    stdio: ["ignore", out, out],
  }).unref();
  for (let tries = 0; tries < 100; tries++) {
    await Bun.sleep(100);
    const running = await findServer(serverFile);
    if (running !== null) return running;
  }
  throw new Error(`diffy did not start; its log is ${log}`);
}

async function mcp(host: Host, url: string | undefined) {
  const serverFile = serverFilePath(host.stateDir);
  const here = await probeRepo(process.cwd(), host.home);
  const given = url === undefined ? null : new URL("/mcp", url);
  await bridge(console, (line) => process.stdout.write(`${line}\n`), {
    workspace: here.kind === "jj" ? here.root : null,
    find: async () =>
      given ??
      new URL(
        "/mcp",
        (
          (await findServer(serverFile)) ??
          (await startInBackground(host.diffy, serverFile))
        ).url,
      ),
  });
}

```

## `diffy wait`

An agent runs `diffy wait <review>` in the background once it has handed the
reader a review, and the command
[exits when the reader submits it](agents.md#telling-an-agent-the-reader-submitted),
printing what the agent should do next. It finds the server the way the
bridge does, or takes `--url`, but never starts one: the reader needs a
server up to submit at all. Until one is up it keeps looking.
`register_review` hands the agent the command spelled out for the server it
called, so an agent that reaches diffy over HTTP need not have `diffy` on its
`PATH`. A review that does not exist, or a directory that is not a jj
workspace, ends it with an error, so the agent is not left waiting on
nothing.

```ts
//| id: cli-module

async function wait(host: Host, review: string, url: string | undefined) {
  const here = await probeRepo(process.cwd(), host.home);
  if (here.kind !== "jj") fail(2, "diffy wait runs in a jj workspace");
  const serverFile = serverFilePath(host.stateDir);
  const given = url === undefined ? null : new URL("/mcp", url);
  const heard = await waitFor(review, here.root, async () => {
    if (given !== null) return given;
    const found = await findServer(serverFile);
    return found === null ? null : new URL("/mcp", found.url);
  });
  if ("error" in heard) fail(1, heard.error);
  console.log(
    `The reader submitted their review of ${heard.review} at v${heard.version}. Read its comments with read_comments and address them.`,
  );
}

if (import.meta.main) {
  const host = hostFrom(process.env);
  const command = parseCommand(Bun.argv.slice(2));
  switch (command.kind) {
    case "help":
      console.log(USAGE);
      break;
    case "usage-error":
      fail(2, `${command.reason}\n${USAGE}`);
      break;
    case "serve":
      await serve(host, command.path, command.port, command.open);
      break;
    case "mcp":
      await mcp(host, command.url);
      break;
    case "wait":
      await wait(host, command.review, command.url);
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

test("wait takes one review and an optional server URL", () => {
  expect(parseCommand(["wait", "t"])).toEqual({ kind: "wait", review: "t" });
  expect(parseCommand(["wait", "t", "--url", "http://localhost:4000"])).toEqual(
    { kind: "wait", review: "t", url: "http://localhost:4000" },
  );
  expect(parseCommand(["wait"]).kind).toBe("usage-error");
  expect(parseCommand(["wait", "t", "u"]).kind).toBe("usage-error");
  expect(parseCommand(["wait", "t", "--url", "nope"]).kind).toBe("usage-error");
});

test("--help asks for the usage", () => {
  expect(parseCommand(["--help"])).toEqual({ kind: "help" });
});
```
