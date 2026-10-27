// ~/~ begin <<docs/architecture/backend/agents.md#backend-agent-listeners-test>>[init]
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { AgentListeners, follow, waitFor } from "./listeners";

test("tells only the waiters on the review in its repository", async () => {
  // arrange
  const dir = await mkdtemp(join(tmpdir(), "diffy-listen-"));
  const main = join(dir, "main");
  const second = join(dir, "second");
  const apart = join(dir, "apart");
  try {
    await $`jj git init ${main} && jj git init ${apart}`.quiet();
    await $`jj workspace add ${second}`.cwd(main).quiet();
    const listeners = new AgentListeners();
    const heard: string[] = [];
    const wait = (root: string, review: string | null, as: string) =>
      listeners.add({
        root,
        review,
        send: (line) => heard.push(`${as} ${line}`),
      });
    wait(second, "t", "second");
    wait(main, "u", "other review");
    wait(apart, "t", "other repo");
    wait(dir, "t", "no repo");
    wait(second, null, "every review");
    wait(apart, null, "every review apart");
    const gone = wait(main, "t", "gone");
    gone();

    // act
    const told = await listeners.tell(main, { review: "t", version: 2 });

    // assert
    expect(told).toBe(2);
    expect(heard).toEqual([
      'second {"review":"t","version":2}',
      'every review {"review":"t","version":2}',
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("waits for a server, then for what it sends", async () => {
  // arrange
  const server = Bun.serve({
    port: 0,
    routes: {
      "/mcp/listen": (req: Request, server: Bun.Server<string>) => {
        const asked = new URL(req.url).searchParams;
        const data = `${asked.get("review")} in ${asked.get("workspace")}`;
        return server.upgrade(req, { data })
          ? undefined
          : new Response(null, { status: 400 });
      },
    },
    websocket: {
      open(ws: Bun.ServerWebSocket<string>) {
        ws.send(JSON.stringify({ error: ws.data }));
      },
      message() {},
    },
  });
  let asked = 0;
  const running = async () =>
    asked++ === 0 ? null : new URL("/mcp", server.url);

  try {
    // act
    const heard = await waitFor("t", "/src/a", running, 10);

    // assert
    expect(heard).toEqual({ error: "t in /src/a" });
    expect(asked).toBe(2);
  } finally {
    server.stop(true);
  }
});

test("follows every event, across a server going away", async () => {
  // arrange
  let opened = 0;
  const server = Bun.serve({
    port: 0,
    routes: {
      "/mcp/listen": (req: Request, server: Bun.Server<string>) => {
        const asked = new URL(req.url).searchParams;
        const data = `${asked.get("review")} in ${asked.get("workspace")}`;
        return server.upgrade(req, { data })
          ? undefined
          : new Response(null, { status: 400 });
      },
    },
    websocket: {
      open(ws: Bun.ServerWebSocket<string>) {
        if (opened++ === 0) {
          ws.send(JSON.stringify({ review: "t", version: 1 }));
          ws.send(JSON.stringify({ review: "u", version: 2 }));
          ws.close();
        } else {
          ws.send(JSON.stringify({ review: "t", version: 3 }));
          ws.send(JSON.stringify({ review: "u", deleted: true }));
          ws.send(JSON.stringify({ error: ws.data }));
        }
      },
      message() {},
    },
  });
  const heard: string[] = [];

  try {
    // act
    const ended = await follow(
      "/src/a",
      async () => new URL("/mcp", server.url),
      (event) =>
        heard.push(
          "deleted" in event
            ? `${event.review} deleted`
            : `${event.review} v${event.version}`,
        ),
      10,
    );

    // assert
    expect(heard).toEqual(["t v1", "u v2", "t v3", "u deleted"]);
    expect(ended).toEqual({ error: "null in /src/a" });
  } finally {
    server.stop(true);
  }
});
// ~/~ end
