// ~/~ begin <<docs/architecture/backend/instance.md#backend-instance>>[init]
import { homedir } from "node:os";
import { join } from "node:path";
import * as z from "zod";

const ServerFile = z.object({ port: z.number().int() });

export function serverFilePath(
  env: Record<string, string | undefined> = process.env,
): string {
  const stateHome = env.XDG_STATE_HOME || join(homedir(), ".local", "state");
  return join(stateHome, "diffy", "server.json");
}

export async function storedPort(
  path = serverFilePath(),
): Promise<number | null> {
  const parsed = ServerFile.safeParse(
    await Bun.file(path)
      .json()
      .catch(() => null),
  );
  return parsed.success ? parsed.data.port : null;
}

export async function storePort(port: number, path = serverFilePath()) {
  await Bun.write(path, `${JSON.stringify({ port })}\n`);
}

const FIRST_PORT = 20000;
const PORT_COUNT = 32768 - FIRST_PORT;

export function rollPort(random = Math.random): number {
  return FIRST_PORT + Math.floor(random() * PORT_COUNT);
}
// ~/~ end
// ~/~ begin <<docs/architecture/backend/instance.md#backend-instance>>[1]

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
export async function findServer(
  path = serverFilePath(),
): Promise<RunningServer | null> {
  const port = await storedPort(path);
  return port === null ? null : probe(port);
}
// ~/~ end
