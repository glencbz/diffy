# The per-user server

A `diffy` started without `--port` is the user's one server. It keeps its
port across runs in a state file, and everything else that needs it, a second
`diffy` or [`diffy mcp`](agents.md#the-stdio-bridge), finds it through that
file rather than a port number in its config. The
[command line](cli.md#the-sticky-port) binds the port and writes the file.

## A port nobody else wants

The first run draws a port at random and every later run reuses it, so the
address is stable on one machine without diffy claiming a well-known number on
every machine. A fixed obscure default would be simpler, but a clash with it
breaks every agent's MCP config at once and nothing says why.

The range sits below the ports Linux (32768 and up) and macOS (49152 and up)
hand out for outgoing connections, so a browser tab or a `git fetch` never
holds diffy's port when it restarts, and above the 3000s, 4000s, and 8000s dev
servers reach for.

A stale file is harmless: `probe` asks the port whether it is diffy, so a
program that took the port since is passed over, and the next start draws a
new one.

```ts
//| id: backend-instance
//| file: src/backend/instance/instance.ts
import { join } from "node:path";
import * as z from "zod";

const ServerFile = z.object({ port: z.number().int() });

export function serverFilePath(stateDir: string): string {
  return join(stateDir, "server.json");
}

export async function storedPort(path: string): Promise<number | null> {
  const parsed = ServerFile.safeParse(
    await Bun.file(path)
      .json()
      .catch(() => null),
  );
  return parsed.success ? parsed.data.port : null;
}

export async function storePort(port: number, path: string) {
  await Bun.write(path, `${JSON.stringify({ port })}\n`);
}

const FIRST_PORT = 20000;
const PORT_COUNT = 32768 - FIRST_PORT;

export function rollPort(random = Math.random): number {
  return FIRST_PORT + Math.floor(random() * PORT_COUNT);
}
```

## Is diffy up

`GET /api/repo` [answers](repos.md#routes) with `diffy: 1` beside the served
repository, which is what tells diffy apart from whatever else might answer
on the port.

```ts
//| id: backend-instance

const Identity = z.object({
  diffy: z.literal(1),
  current: z.string().nullable(),
});

export interface RunningServer {
  url: URL;
  /** The repository it serves, if one is open. */
  current: string | null;
}

export async function probe(port: number): Promise<RunningServer | null> {
  const url = new URL(`http://localhost:${port}/`);
  try {
    const res = await fetch(new URL("/api/repo", url), {
      signal: AbortSignal.timeout(2000),
    });
    const body = Identity.safeParse(await res.json());
    return body.success ? { url, current: body.data.current } : null;
  } catch {
    return null;
  }
}

/** The per-user server, if one is up. */
export async function findServer(path: string): Promise<RunningServer | null> {
  const port = await storedPort(path);
  return port === null ? null : probe(port);
}
```

## Tests

```ts
//| id: backend-instance-test
//| file: src/backend/instance/instance.test.ts
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findServer, probe, rollPort, storedPort, storePort } from "./instance";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "diffy-instance-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("a stored port reads back, and a missing or bad file is none", async () => {
  const path = join(dir, "diffy", "server.json");
  expect(await storedPort(path)).toBeNull();
  await storePort(24817, path);
  expect(await storedPort(path)).toBe(24817);
  await Bun.write(path, "not json");
  expect(await storedPort(path)).toBeNull();
});

test("a rolled port stays below the ephemeral ranges", () => {
  expect(rollPort(() => 0)).toBe(20000);
  expect(rollPort(() => 0.999999)).toBe(32767);
});

test("only a server that says it is diffy is found", async () => {
  const diffy = Bun.serve({
    port: 0,
    fetch: () => Response.json({ diffy: 1, current: "/src/a", home: "/" }),
  });
  const other = Bun.serve({ port: 0, fetch: () => Response.json({}) });
  const portOf = (server: Bun.Server<undefined>) => Number(server.url.port);
  try {
    expect((await probe(portOf(diffy)))?.current).toBe("/src/a");
    expect(await probe(portOf(other))).toBeNull();

    const path = join(dir, "server.json");
    expect(await findServer(path)).toBeNull();
    await storePort(portOf(diffy), path);
    expect((await findServer(path))?.url.port).toBe(diffy.url.port);
  } finally {
    diffy.stop(true);
    other.stop(true);
  }
});
```
