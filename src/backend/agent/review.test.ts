// ~/~ begin <<docs/architecture/backend/agents.md#backend-agent-test>>[init]
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FIXED } from "../../testing/history";
import { openReviewStore, type ReviewStore } from "../review/store";
import { mcpRoute } from "./mcp";
import { INSTRUCTIONS, reviewTools } from "./review";

/** The repository these tests read. */
const ROOT = process.cwd();

let dir: string;
let store: ReviewStore;
let route: ReturnType<typeof mcpRoute>;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "diffy-agent-"));
  store = openReviewStore(join(dir, "r.sqlite"));
  const repo = { root: ROOT, store, topic: "t" };
  route = mcpRoute(reviewTools(), INSTRUCTIONS, async () => ({
    repo,
    link: (path) => `https://vm:4000${path}`,
    wait: (name) => `diffy wait ${name}`,
    now: () => new Date(),
  }));
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

const TIP = FIXED.commit;

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
      "delete_review",
      "review_status",
      "read_comments",
      "read_review_history",
      "add_comment",
      "reply_to_comment",
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
    const tip = { commitId: FIXED.commit, changeId: FIXED.changeId };
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
    const tip = { commitId: FIXED.commit, changeId: FIXED.changeId };
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
    const tip = { commitId: FIXED.commit, changeId: FIXED.changeId };
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
      revset: `${TIP} | ${FIXED.parent}`,
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
    expect(second.text.split("\n").at(-1)).toBe(
      "Run in the background to hear when the reader submits: diffy wait t",
    );
    expect(second.text.split("\n")[1]).toBe("v2, against v1:");
    expect(second.text).toContain(
      `${tip.changeId.slice(0, 8)} ${tip.commitId.slice(0, 8)} same`,
    );
    expect(listed.text).toContain(
      "the reader's turn: v2 waits for review, v1 reviewed",
    );
  });

  test("threads a reply under the reader's comment", async () => {
    // arrange
    const tip = { commitId: FIXED.commit, changeId: FIXED.changeId };
    await call("register_review", { name: "t", revset: TIP });
    const added = await call("add_comment", {
      name: "t",
      change: tip.changeId,
      body: "why this?",
    });

    // act
    const replied = await call("reply_to_comment", {
      id: added.text,
      body: "because",
    });
    const read = await call("read_comments", { name: "t" });
    const missing = await call("reply_to_comment", { id: "nope", body: "x" });

    // assert
    expect(JSON.parse(read.text)).toEqual([
      expect.objectContaining({
        id: added.text,
        replies: [{ id: replied.text, author: "claude", body: "because" }],
      }),
    ]);
    expect(missing).toEqual({ text: "no comment has id nope", isError: true });
  });

  test("names where a thread on a capture or a run sits", async () => {
    // arrange
    const tip = { commitId: FIXED.commit, changeId: FIXED.changeId };
    await call("register_review", { name: "t", revset: TIP });
    const written = {
      reviewKey: `change:${tip.changeId}`,
      commitId: tip.commitId,
      body: "",
      resolved: false,
      createdAt: "2026-10-26T00:00:00.000Z",
      author: "reader",
      replies: [],
    };
    store.apply({
      kind: "add-comment",
      comment: {
        ...written,
        id: "on-capture",
        kind: "capture",
        capture: "settings",
        side: "after",
        box: [0.1, 0.2, 0.3, 0.4],
        at: null,
      },
    });
    store.apply({
      kind: "add-comment",
      comment: {
        ...written,
        id: "on-request",
        kind: "step",
        run: "checkout",
        step: 0,
        side: "after",
        box: null,
        request: { method: "GET", url: "/api/cart" },
        console: null,
      },
    });

    // act
    const read = await call("read_comments", { name: "t" });

    // assert
    expect(
      JSON.parse(read.text).map((each: { at: string }) => each.at),
    ).toEqual([
      "capture settings, a box [0.100, 0.200, 0.300, 0.400]",
      "run checkout, step 1, GET /api/cart",
    ]);
  });

  test("deletes a review so the reader can restore it", async () => {
    // arrange
    await call("register_review", { name: "t", revset: TIP });

    // act
    const deleted = await call("delete_review", { name: "t" });
    const listed = await call("list_reviews", {});
    const again = await call("delete_review", { name: "t" });
    store.apply({ kind: "restore-review", name: "t" });
    const restored = await call("list_reviews", {});
    const missing = await call("delete_review", { name: "nope" });

    // assert
    expect(deleted.text).toStartWith("deleted t; the reader can restore it");
    expect(listed.text).toBe("no local reviews");
    expect(again.text).toBe("t was already deleted");
    expect(restored.text).toStartWith("t: ");
    expect(missing).toEqual({
      text: "no local review is named nope",
      isError: true,
    });
  });

  test("reads what the reader wrote in a window across reviews", async () => {
    // arrange
    const tip = { commitId: FIXED.commit, changeId: FIXED.changeId };
    await call("register_review", { name: "t", revset: TIP });
    const comment = (id: string, createdAt: string, commitId: string) => ({
      kind: "add-comment" as const,
      comment: {
        id,
        reviewKey: `change:${tip.changeId}`,
        commitId,
        body: id,
        resolved: false,
        createdAt,
        author: "reader",
        replies: [],
        kind: "comparison" as const,
      },
    });
    store.apply(comment("before", "2026-09-01T00:00:00Z", tip.commitId));
    store.apply(comment("inside", "2026-10-02T00:00:00.000Z", tip.commitId));
    store.apply(comment("on a pull", "2026-10-03T00:00:00Z", "f".repeat(40)));
    const agents = await call("add_comment", {
      name: "t",
      change: tip.changeId,
      body: "why this way?",
    });
    store.apply({
      kind: "add-reply",
      commentId: agents.text,
      reply: {
        id: "r",
        body: "because",
        createdAt: "2026-10-04T00:00:00Z",
        author: "reader",
      },
    });
    store.apply({
      kind: "mark-reviewed",
      series: "local:t",
      version: "1",
      at: "2026-10-05T00:00:00Z",
    });

    // act
    const read = await call("read_review_history", {
      since: "2026-10-01",
      until: "2026-10-06",
    });
    const bad = await call("read_review_history", { since: "last week" });

    // assert
    const history = JSON.parse(read.text);
    expect(history.reviewed).toEqual([
      { series: "local:t", version: "v1", at: "2026-10-05T00:00:00Z" },
    ]);
    expect(history.threads).toEqual([
      expect.objectContaining({
        id: "inside",
        review: "t",
        link: "https://vm:4000/reviews/t",
        change: tip.changeId.slice(0, 8),
      }),
      expect.objectContaining({ id: "on a pull", review: null, change: null }),
      expect.objectContaining({
        id: agents.text,
        author: "claude",
        replies: [
          {
            author: "reader",
            body: "because",
            createdAt: "2026-10-04T00:00:00Z",
          },
        ],
      }),
    ]);
    expect(bad.isError).toBe(true);
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
