// ~/~ begin <<docs/architecture/backend/agents.md#backend-agent-bridge-test>>[init]
import { afterEach, beforeEach, expect, test } from "bun:test";
import * as z from "zod";
import { openReviewStore } from "../review/store";
import { bridge } from "./bridge";
import { mcpRoute, tool } from "./mcp";

const echo = tool({
  name: "echo",
  description: "echo",
  input: z.object({ text: z.string() }),
  call: async ({ text }, { repo }) => `${text} from ${repo.root}`,
});

const store = openReviewStore(":memory:");

let server: Bun.Server<undefined>;
let mcp: URL;
beforeEach(() => {
  const route = mcpRoute([echo], "", async (_req, caller) => ({
    repo: { root: caller ?? "/reader", store },
    link: (path) => `http://reader${path}`,
  }));
  server = Bun.serve({ port: 0, routes: { "/mcp": route } });
  mcp = new URL("/mcp", server.url);
});
afterEach(() => {
  server.stop(true);
});

async function* linesOf(...messages: unknown[]) {
  for (const message of messages) yield JSON.stringify(message);
}

interface Answer {
  id: unknown;
  result?: { content: { type: string; text: string }[]; isError?: boolean };
  error?: { message: string };
}

async function relay(
  workspace: string | null,
  find: () => Promise<URL>,
  ...messages: unknown[]
) {
  const written: Answer[] = [];
  await bridge(linesOf(...messages), (line) => written.push(JSON.parse(line)), {
    workspace,
    find,
  });
  return written.sort((a, b) => Number(a.id) - Number(b.id));
}

const callEcho = (id: number) => ({
  jsonrpc: "2.0",
  id,
  method: "tools/call",
  params: { name: "echo", arguments: { text: "hi" } },
});

test("answers each request and nothing for a notification", async () => {
  const answers = await relay(
    "/src/a",
    async () => mcp,
    { jsonrpc: "2.0", id: 1, method: "tools/list" },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    callEcho(2),
  );
  expect(answers.map((each) => each.id)).toEqual([1, 2]);
  expect(answers[1]?.result?.content[0]?.text).toBe("hi from /src/a");
});

test("names its workspace, so each call runs in it", async () => {
  const [named] = await relay("/src/b", async () => mcp, callEcho(1));
  expect(named?.result?.content[0]?.text).toBe("hi from /src/b");
  const [unnamed] = await relay(null, async () => mcp, callEcho(1));
  expect(unnamed?.result?.content[0]?.text).toBe("hi from /reader");
});

test("finds the server again after a post fails", async () => {
  const gone = Bun.serve({ port: 0, fetch: () => new Response() });
  const stale = new URL("/mcp", gone.url);
  gone.stop(true);
  const found = [stale, mcp];
  const [answer] = await relay(
    "/src/a",
    async () => found.shift() ?? mcp,
    callEcho(1),
  );
  expect(answer?.result?.content[0]?.text).toBe("hi from /src/a");
});

test("answers with an error when no server can be found", async () => {
  const [answer] = await relay(
    "/src/a",
    async () => {
      throw new Error("diffy did not start");
    },
    callEcho(1),
  );
  expect(answer?.error?.message).toBe("diffy did not start");
});
// ~/~ end
