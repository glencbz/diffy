// ~/~ begin <<docs/architecture/frontend/review.md#frontend-persistence-review>>[init]
import * as z from "zod";
import { type ReviewCommand, ReviewSnapshot } from "../model/review";

const ErrorAnswer = z.object({ error: z.string() });

/** The server's answer, or the error it gave in its place. */
async function snapshotOf(res: Response): Promise<ReviewSnapshot> {
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const error = ErrorAnswer.safeParse(body);
    throw new Error(
      error.success
        ? error.data.error
        : `the review store answered ${res.status}`,
    );
  }
  return ReviewSnapshot.parse(body);
}

/** The review document as the server keeps it. */
export const reviewStore = {
  async load(): Promise<ReviewSnapshot> {
    return snapshotOf(await fetch("/api/review"));
  },
  async send(command: ReviewCommand): Promise<ReviewSnapshot> {
    return snapshotOf(
      await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(command),
      }),
    );
  },
  /** Calls `onChange` with each revision the server announces, and once
   *  each time the socket opens, since a write may have landed while it
   *  was closed. Reconnects until the returned function is called. */
  watch(onChange: (revision: number | null) => void): () => void {
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const url = new URL("/api/review/changes", location.href);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";

    const connect = () => {
      socket = new WebSocket(url);
      socket.onopen = () => onChange(null);
      socket.onmessage = (event) => {
        const change = Change.safeParse(JSON.parse(String(event.data)));
        if (change.success) onChange(change.data.revision);
      };
      socket.onclose = () => {
        if (!stopped) retry = setTimeout(connect, 2000);
      };
    };
    connect();

    return () => {
      stopped = true;
      clearTimeout(retry);
      socket?.close();
    };
  },
};

const Change = z.object({ revision: z.number().int() });
// ~/~ end
