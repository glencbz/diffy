// ~/~ begin <<docs/architecture/backend/cli.md#cli-module>>[init]
import { parseArgs } from "node:util";
import { $ } from "bun";
import { difftDirectories } from "./backend/commit/difft";
import {
  openReviewStore,
  type ReviewStore,
  reviewStorePath,
} from "./backend/review/store";
import { routes } from "./server";

const USAGE = "usage: diffy [--port <n>]";

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
// ~/~ end
// ~/~ begin <<docs/architecture/backend/cli.md#cli-module>>[1]

function fail(status: number, message: string): never {
  console.error(`diffy: ${message}`);
  process.exit(status);
}

function listen(choice: PortChoice, store: ReviewStore): Bun.Server<undefined> {
  const first = choice.kind === "given" ? choice.port : choice.from;
  for (let port = first; ; port++) {
    try {
      return Bun.serve({ port, routes: routes(store) });
    } catch (error) {
      if ((error as { code?: unknown }).code !== "EADDRINUSE") throw error;
      if (choice.kind === "given") fail(1, `port ${port} is in use`);
    }
  }
}

async function serve(choice: PortChoice): Promise<void> {
  const root = await $`jj root`.quiet().nothrow();
  if (root.exitCode !== 0) fail(1, root.stderr.toString().trim());

  const store = openReviewStore(await reviewStorePath());
  const server = listen(choice, store);
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
// ~/~ end
