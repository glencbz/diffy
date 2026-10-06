// ~/~ begin <<docs/architecture/backend/agents.md#backend-agent-test>>[init]
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { jjLog } from "../commit/jj";
import { openReviewStore, type ReviewStore } from "../review/store";
import { mcpRoute } from "./mcp";
import { INSTRUCTIONS, reviewTools } from "./review";

let dir: string;
let store: ReviewStore;
let route: ReturnType<typeof mcpRoute>;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "diffy-agent-"));
  store = openReviewStore(join(dir, "r.sqlite"));
  route = mcpRoute(reviewTools(store), INSTRUCTIONS, () => "https://vm:4000");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

let nextId = 1;

function send(method: string, params?: unknown): Promise<Response> {
  return route.POST(
    new Request("http://localhost/mcp", {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
    }),
  );
}

async function call(
  name: string,
  args: Record<string, unknown>,
): Promise<{ text: string; isError: boolean }> {
  const res = await send("tools/call", { name, arguments: args });
  const body = (await res.json()) as {
    result: { content: { text: string }[]; isError?: boolean };
  };
  return {
    text: body.result.content[0]?.text ?? "",
    isError: body.result.isError ?? false,
  };
}

const TIP = "latest(::trunk() ~ empty())";

describe("the protocol", () => {
  test("agrees a version a client asks for and lists every tool", async () => {
    // arrange
    // act
    const init = (await (
      await send("initialize", { protocolVersion: "2025-06-18" })
    ).json()) as { result: { protocolVersion: string } };
    const list = (await (await send("tools/list")).json()) as {
      result: { tools: { name: string; inputSchema: { type: string } }[] };
    };

    // assert
    expect(init.result.protocolVersion).toBe("2025-06-18");
    expect(list.result.tools.map((each) => each.name)).toEqual([
      "register_review",
      "list_reviews",
      "review_status",
      "read_comments",
      "add_comment",
      "resolve_comment",
    ]);
    expect(
      list.result.tools.every((each) => each.inputSchema.type === "object"),
    ).toBe(true);
  });

  test("accepts a notification with no answer and refuses a stream", async () => {
    // arrange
    const notification = new Request("http://localhost/mcp", {
      method: "POST",
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      }),
    });

    // act
    const accepted = await route.POST(notification);
    const refused = route.GET();

    // assert
    expect(accepted.status).toBe(202);
    expect(refused.status).toBe(405);
  });

  test("answers an unknown method with an error", async () => {
    // arrange
    // act
    const body = (await (await send("resources/list")).json()) as {
      error: { code: number };
    };

    // assert
    expect(body.error.code).toBe(-32601);
  });
});

describe("the review tools", () => {
  test("registers a review, comments on it, and reads the comment back", async () => {
    // arrange
    const [tip] = await jjLog({ revset: TIP });
    if (tip === undefined) throw new Error("no history");
    const registered = await call("register_review", {
      name: "t",
      revset: TIP,
    });

    // act
    const added = await call("add_comment", {
      name: "t",
      change: tip.changeId.slice(0, 8),
      path: "README.md",
      line: 1,
      body: "look here",
    });
    const read = await call("read_comments", { name: "t" });

    // assert
    expect(registered.text.split("\n").slice(0, 2)).toEqual([
      "https://vm:4000/reviews/t",
      "v1:",
    ]);
    expect(added.isError).toBe(false);
    expect(JSON.parse(read.text)).toEqual([
      expect.objectContaining({
        id: added.text,
        author: "claude",
        at: "README.md:1",
        body: "look here",
        stale: false,
      }),
    ]);
  });

  test("leaves a resolved comment out of the unresolved ones", async () => {
    // arrange
    const [tip] = await jjLog({ revset: TIP });
    if (tip === undefined) throw new Error("no history");
    await call("register_review", { name: "t", revset: TIP });
    const added = await call("add_comment", {
      name: "t",
      change: tip.commitId,
      body: "the whole commit",
    });

    // act
    await call("resolve_comment", { id: added.text });
    const open = await call("read_comments", { name: "t" });
    const all = await call("read_comments", {
      name: "t",
      unresolvedOnly: false,
    });

    // assert
    expect(JSON.parse(open.text)).toEqual([]);
    expect(JSON.parse(all.text)).toHaveLength(1);
  });

  test("hands the turn over when the reader marks the newest version", async () => {
    // arrange
    const [tip] = await jjLog({ revset: TIP });
    if (tip === undefined) throw new Error("no history");
    // v1 is written at an operation of its own, since the tool registering
    // v2 reads the live repo and a test cannot make a new operation in it.
    store.apply({
      kind: "register",
      name: "t",
      version: {
        operation: "earlier",
        revset: TIP,
        commits: [tip.commitId],
        registeredAt: "2026-10-05T00:00:00Z",
      },
    });
    const waiting = await call("review_status", { name: "t" });
    store.apply({
      kind: "mark-reviewed",
      series: "local:t",
      version: "1",
      at: "2026-10-06T00:00:00Z",
    });

    // act
    const reviewed = await call("review_status", { name: "t" });
    const again = await call("register_review", { name: "t" });
    const second = await call("register_review", {
      name: "t",
      revset: `${TIP} | ${TIP}-`,
    });
    const listed = await call("list_reviews", {});

    // assert
    expect(JSON.parse(waiting.text)).toMatchObject({ turn: "reader" });
    expect(JSON.parse(reviewed.text)).toMatchObject({
      turn: "agent",
      reviewed: [{ version: "v1" }],
      changes: [{ change: tip.changeId.slice(0, 8), sinceReviewed: "same" }],
    });
    expect(again.text).toContain("v1 already has these commits");
    expect(second.text.split("\n")[1]).toBe("v2, against v1:");
    expect(second.text).toContain(
      `${tip.changeId.slice(0, 8)} ${tip.commitId.slice(0, 8)} same`,
    );
    expect(listed.text).toContain(
      "the reader's turn: v2 waits for review, v1 reviewed",
    );
  });

  test("tells the agent what it got wrong as a failed call", async () => {
    // arrange
    // act
    const missing = await call("read_comments", { name: "nope" });
    const nameless = await call("register_review", {});

    // assert
    expect(missing).toEqual({
      text: "no local review is named nope",
      isError: true,
    });
    expect(nameless.isError).toBe(true);
  });
});
// ~/~ end
