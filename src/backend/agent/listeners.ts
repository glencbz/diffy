// ~/~ begin <<docs/architecture/backend/agents.md#backend-agent-listeners>>[init]
import { jjRepoDir } from "../commit/jj";

/** Where `diffy wait` listens, beside the `/mcp` the bridge posts to. */
export const LISTEN_PATH = "/mcp/listen";

/** What the reader did to a review: submitted a version of it, or deleted
 *  it. */
export type ReviewEvent =
  | { review: string; version: number }
  | { review: string; deleted: true };

/** What a waiter hears: what the reader did, or why there is nothing to
 *  wait for. */
export type Heard = ReviewEvent | { error: string };

export interface Listener {
  /** A directory in the repository whose review is waited on. */
  root: string;
  /** The review waited on, or `null` to follow every review. */
  review: string | null;
  send: (line: string) => void;
}

/** The waiters at `LISTEN_PATH`, for what the reader does to reviews. */
export class AgentListeners {
  #listening = new Set<Listener>();

  /** Adds a waiter; the returned function removes it. */
  add(listener: Listener): () => void {
    this.#listening.add(listener);
    return () => this.#listening.delete(listener);
  }

  /** Tells each waiter on the event's review in `root`'s repository what
   *  the reader did, and says how many it told. */
  async tell(root: string, event: ReviewEvent) {
    const { review } = event;
    const line = JSON.stringify(event satisfies Heard);
    const repo = await jjRepoDir(root).catch(() => null);
    const told = await Promise.all(
      [...this.#listening].map(async (listener) => {
        if (listener.review !== null && listener.review !== review) {
          return false;
        }
        const theirs = await jjRepoDir(listener.root).catch(() => null);
        if (theirs === null || theirs !== repo) return false;
        listener.send(line);
        return true;
      }),
    );
    return told.filter(Boolean).length;
  }
}

/** Waits at the running server for the reader to submit or delete
 *  `review`, looking for a server again whenever none is up or the one
 *  listened on goes away. */
export async function waitFor(
  review: string,
  workspace: string,
  running: () => Promise<URL | null>,
  retryMs = 1000,
): Promise<Heard> {
  for (;;) {
    const server = await running().catch(() => null);
    if (server !== null) {
      const heard = await new Promise<Heard | null>((resolve) => {
        const socket = new WebSocket(listenUrl(server, workspace, review));
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

/** Follows every review at the running server, handing each event to
 *  `hear` until the server answers with an error, and looking for a server
 *  again whenever none is up or the one followed goes away. */
export async function follow(
  workspace: string,
  running: () => Promise<URL | null>,
  hear: (event: ReviewEvent) => void,
  retryMs = 1000,
): Promise<{ error: string }> {
  for (;;) {
    const server = await running().catch(() => null);
    if (server !== null) {
      const failed = await new Promise<{ error: string } | null>((resolve) => {
        const socket = new WebSocket(listenUrl(server, workspace, null));
        socket.onmessage = (event) => {
          const heard = JSON.parse(String(event.data)) as Heard;
          if ("error" in heard) {
            resolve(heard);
            socket.close();
          } else {
            hear(heard);
          }
        };
        socket.onclose = () => resolve(null);
      });
      if (failed !== null) return failed;
    }
    await Bun.sleep(retryMs);
  }
}

function listenUrl(server: URL, workspace: string, review: string | null) {
  const url = new URL(LISTEN_PATH, server);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("workspace", workspace);
  if (review !== null) url.searchParams.set("review", review);
  return url;
}
// ~/~ end
