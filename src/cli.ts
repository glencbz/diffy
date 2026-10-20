// ~/~ begin <<docs/architecture/backend/cli.md#cli-module>>[init]
import { spawn } from "node:child_process";
import { openSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { bridge } from "./backend/agent/bridge";
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
import { type ReviewSocket, reviewSocket, routes } from "./server";

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
// ~/~ end
// ~/~ begin <<docs/architecture/backend/cli.md#cli-module>>[1]

function fail(status: number, message: string): never {
  console.error(`diffy: ${message}`);
  process.exit(status);
}

type Bind = (port: number) => Bun.Server<ReviewSocket> | null;

type Listening =
  | { kind: "bound"; server: Bun.Server<ReviewSocket> }
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

  let server: Bun.Server<ReviewSocket> | null = null;
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
        routes: routes(host, defaultRepo, recent, workspaces),
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
// ~/~ end
// ~/~ begin <<docs/architecture/backend/cli.md#cli-module>>[2]

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
// ~/~ end
// ~/~ begin <<docs/architecture/backend/cli.md#cli-module>>[3]

async function startInBackground(serverFile: string): Promise<RunningServer> {
  const log = join(dirname(serverFile), "server.log");
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
          (await startInBackground(serverFile))
        ).url,
      ),
  });
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
    case "difft":
      process.stdout.write(
        JSON.stringify(await difftDirectories(command.left, command.right)),
      );
      break;
  }
}
// ~/~ end
