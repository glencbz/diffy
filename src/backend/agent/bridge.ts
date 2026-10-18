// ~/~ begin <<docs/architecture/backend/agents.md#backend-agent-bridge>>[init]
import { CALLER_HEADER } from "./mcp";

export interface BridgeOptions {
  /** The jj workspace the agent runs in, or null outside one. */
  workspace: string | null;
  /** The server's `/mcp`, asked for again after a post to it fails. */
  find: () => Promise<URL>;
}

export async function bridge(
  lines: AsyncIterable<string>,
  write: (line: string) => void,
  { workspace, find }: BridgeOptions,
): Promise<void> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (workspace !== null) {
    headers[CALLER_HEADER] = encodeURIComponent(workspace);
  }

  let target: Promise<URL> | null = null;
  const post = async (body: string, retry: boolean): Promise<Response> => {
    try {
      target ??= find();
      return await fetch(await target, { method: "POST", headers, body });
    } catch (error) {
      target = null;
      if (!retry) throw error;
      return post(body, false);
    }
  };

  const relay = async (line: string) => {
    const id = idOf(line);
    try {
      const res = await post(line, true);
      if (res.status === 202) return;
      if (!res.headers.get("Content-Type")?.includes("json")) {
        throw new Error(`diffy answered ${res.status}`);
      }
      write(await res.text());
    } catch (error) {
      // A notification has no id to answer under.
      if (id === null) return;
      write(
        JSON.stringify({
          jsonrpc: "2.0",
          id,
          error: { code: -32603, message: (error as Error).message },
        }),
      );
    }
  };

  const inFlight = new Set<Promise<void>>();
  for await (const line of lines) {
    if (line.trim() === "") continue;
    const relayed = relay(line).finally(() => inFlight.delete(relayed));
    inFlight.add(relayed);
  }
  await Promise.all(inFlight);
}

function idOf(line: string): string | number | null {
  try {
    const { id } = JSON.parse(line) as { id?: unknown };
    return typeof id === "string" || typeof id === "number" ? id : null;
  } catch {
    return null;
  }
}
// ~/~ end
