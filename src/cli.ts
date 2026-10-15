// ~/~ begin <<docs/architecture/backend/cli.md#cli-module>>[init]
import { parseArgs } from "node:util";
import { difftDirectories } from "./backend/commit/difft";
import { RecentRepos, ServedRepo, startingRepo } from "./backend/repo/repos";
import { REVIEW_TOPIC, reviewSocket, routes } from "./server";

const USAGE = "usage: diffy [<path>] [--port <n>]";

// A typed port is held to and a busy one ends the run; otherwise diffy walks
// up from 3000 so several repositories can be served side by side.
export type PortChoice =
  | { kind: "given"; port: number }
  | { kind: "first-free"; from: number };

export type Command =
  | { kind: "serve"; path?: string; port: PortChoice }
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
  let positionals: string[];
  try {
    ({ values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        port: { type: "string", short: "p" },
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
  if (values.port === undefined) {
    return { kind: "serve", ...at, port: { kind: "first-free", from: 3000 } };
  }
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { kind: "usage-error", reason: `not a port: ${values.port}` };
  }
  return { kind: "serve", ...at, port: { kind: "given", port } };
}
// ~/~ end
// ~/~ begin <<docs/architecture/backend/cli.md#cli-module>>[1]

function fail(status: number, message: string): never {
  console.error(`diffy: ${message}`);
  process.exit(status);
}

function listen(
  choice: PortChoice,
  served: ServedRepo,
  recent: RecentRepos,
): Bun.Server<undefined> {
  const first = choice.kind === "given" ? choice.port : choice.from;
  for (let port = first; ; port++) {
    try {
      return Bun.serve({
        port,
        routes: routes(served, recent),
        websocket: reviewSocket,
      });
    } catch (error) {
      if ((error as { code?: unknown }).code !== "EADDRINUSE") throw error;
      if (choice.kind === "given") fail(1, `port ${port} is in use`);
    }
  }
}

async function serve(path: string | undefined, choice: PortChoice) {
  const recent = await RecentRepos.at();
  const start = await startingRepo(path, process.cwd(), await recent.read());
  if (start.kind === "fail") fail(1, start.reason);

  let server: Bun.Server<undefined> | null = null;
  const served = new ServedRepo(recent, (revision) =>
    server?.publish(REVIEW_TOPIC, JSON.stringify({ revision })),
  );
  if (start.kind === "open") {
    await served.open(start.root, start.startedOutside);
  } else {
    served.startedOutside = start.startedOutside;
  }
  server = listen(choice, served, recent);
  // The printed root tells a reader started from a subdirectory, or from
  // outside any repository, which repository they got.
  console.log(
    start.kind === "open"
      ? `diffy serving ${start.root} at ${server.url}`
      : `diffy at ${server.url}: ${start.startedOutside} is not a jj repository, pick one there`,
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
      await serve(command.path, command.port);
      break;
    case "difft":
      process.stdout.write(
        JSON.stringify(await difftDirectories(command.left, command.right)),
      );
      break;
  }
}
// ~/~ end
