// ~/~ begin <<docs/architecture/backend/agents.md#backend-agent-listeners>>[init]
import { jjRepoDir } from "../commit/jj";

/** Where `diffy wait` listens, beside the `/mcp` the bridge posts to. */
export const LISTEN_PATH = "/mcp/listen";

/** What a waiter hears: the version the reader submitted, or why there is
 *  nothing to wait for. */
export type Heard = { review: string; version: number } | { error: string };

export interface Listener {
  /** A directory in the repository whose review is waited on. */
  root: string;
  review: string;
  send: (line: string) => void;
}

/** The waiters at `LISTEN_PATH`, for the reader's submits. */
export class AgentListeners {
  #listening = new Set<Listener>();

  /** Adds a waiter; the returned function removes it. */
  add(listener: Listener): () => void {
    this.#listening.add(listener);
    return () => this.#listening.delete(listener);
  }

  /** Tells each waiter on the review in `root`'s repository that the reader
   *  submitted `version`, and says how many it told. */
  async submitted(root: string, review: string, version: number) {
    const line = JSON.stringify({ review, version } satisfies Heard);
    const repo = await jjRepoDir(root).catch(() => null);
    const told = await Promise.all(
      [...this.#listening].map(async (listener) => {
        if (listener.review !== review) return false;
        const theirs = await jjRepoDir(listener.root).catch(() => null);
        if (theirs === null || theirs !== repo) return false;
        listener.send(line);
        return true;
      }),
    );
    return told.filter(Boolean).length;
  }
}

/** Waits at the running server for the reader to submit `review`, looking
 *  for a server again whenever none is up or the one listened on goes
 *  away. */
export async function waitFor(
  review: string,
  workspace: string,
  running: () => Promise<URL | null>,
  retryMs = 1000,
): Promise<Heard> {
  for (;;) {
    const server = await running().catch(() => null);
    if (server !== null) {
      const url = new URL(LISTEN_PATH, server);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      url.searchParams.set("workspace", workspace);
      url.searchParams.set("review", review);
      const heard = await new Promise<Heard | null>((resolve) => {
        const socket = new WebSocket(url);
        socket.onmessage = (event) => {
          resolve(JSON.parse(String(event.data)) as Heard);
          socket.close();
        };
        socket.onclose = () => resolve(null);
      });
      if (heard !== null) return heard;
    }
    await Bun.sleep(retryMs);
  }
}
// ~/~ end
