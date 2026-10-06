# Agents

An agent reaches the [review document](review-store.md) over MCP at `/mcp`, on
the same server the reader's browser uses. It registers its work as a
[local review](local-reviews.md), reads what the reader wrote on it, and
writes comments of its own, which the reader's screens hear about as they hear
about each other's writes.

## One server for every agent

The route is served by diffy itself, so every agent session on the machine
points at one URL and none runs a process of its own. The other option was a
stdio server each session starts, but that is one more process per session,
and it would either open the store behind the server's back or call the HTTP
API from a second copy of the code. Served in place, the tools apply the same
commands to the same store as `/api/review`.

The cost is that the server does not know the caller's workspace, so nothing
can default to the caller's working copy. `register_review` asks for a name
and reads the bookmark of that name, which an agent has by the time its work
is ready, and [registration](local-reviews.md#registering-a-version) never
reads the server's own working copy for a named review.

## The protocol

MCP's Streamable HTTP transport, stateless: each `POST` carries one JSON-RPC
message and gets one JSON answer, with no session id and no event stream. The
server restarts whenever the code it serves changes, and a stateless route
survives that without the client noticing. The official SDK implements the
same transport, but it brings in about ninety packages, an HTTP framework
among them, for the three methods a tool server needs.

```ts
//| id: backend-agent-mcp
//| file: src/backend/agent/mcp.ts
import * as z from "zod";

/** What a tool sees of the request that called it. */
export interface ToolContext {
  /** Where the reader opens a path of this server's. */
  origin: string;
}

export interface Tool<Input extends z.ZodObject = z.ZodObject> {
  name: string;
  description: string;
  input: Input;
  /** The answer as text. A thrown `ToolError` is shown to the agent as a
   *  failed call; anything else thrown is a fault of the server. */
  call: (input: z.infer<Input>, context: ToolContext) => Promise<string>;
}

/** A call the agent can correct, said in words it can act on. */
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolError";
  }
}

export function tool<Input extends z.ZodObject>(definition: Tool<Input>): Tool {
  return definition as unknown as Tool;
}

// Newest first; a client asking for another is answered with the newest,
// which the protocol leaves it to accept or hang up on.
const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"];

const Message = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string().optional(),
  params: z.record(z.string(), z.unknown()).optional(),
});

const CallParams = z.object({
  name: z.string(),
  arguments: z.record(z.string(), z.unknown()).default({}),
});

type Answer =
  | { result: unknown }
  | { error: { code: number; message: string } };

async function answer(
  method: string,
  params: Record<string, unknown>,
  tools: Tool[],
  instructions: string,
  context: ToolContext,
): Promise<Answer> {
  switch (method) {
    case "initialize": {
      const asked = params.protocolVersion;
      return {
        result: {
          protocolVersion:
            typeof asked === "string" && PROTOCOL_VERSIONS.includes(asked)
              ? asked
              : PROTOCOL_VERSIONS[0],
          capabilities: { tools: {} },
          serverInfo: { name: "diffy", version: "0" },
          instructions,
        },
      };
    }
    case "ping":
      return { result: {} };
    case "tools/list":
      return {
        result: {
          tools: tools.map((each) => ({
            name: each.name,
            description: each.description,
            inputSchema: z.toJSONSchema(each.input, { io: "input" }),
          })),
        },
      };
    case "tools/call": {
      const call = CallParams.safeParse(params);
      const found = call.success
        ? tools.find((each) => each.name === call.data.name)
        : undefined;
      if (!call.success || found === undefined) {
        return { error: { code: -32602, message: "no such tool" } };
      }
      const input = found.input.safeParse(call.data.arguments);
      try {
        if (!input.success) throw new ToolError(z.prettifyError(input.error));
        const text = await found.call(input.data, context);
        return { result: { content: [{ type: "text", text }] } };
      } catch (error) {
        if (!(error instanceof ToolError)) throw error;
        return {
          result: {
            content: [{ type: "text", text: error.message }],
            isError: true,
          },
        };
      }
    }
    default:
      return { error: { code: -32601, message: `no method ${method}` } };
  }
}

export function mcpRoute(
  tools: Tool[],
  instructions: string,
  origin: (req: Request) => string,
) {
  const refuse = () =>
    new Response("only POST", { status: 405, headers: { Allow: "POST" } });
  return {
    GET: refuse,
    DELETE: refuse,
    POST: async (req: Request) => {
      const message = Message.safeParse(await req.json().catch(() => null));
      if (!message.success || message.data.method === undefined) {
        // A notification or a response needs no answer, and a client sends
        // nothing else without a method.
        return message.success
          ? new Response(null, { status: 202 })
          : Response.json(
              {
                jsonrpc: "2.0",
                id: null,
                error: { code: -32700, message: "not a JSON-RPC message" },
              },
              { status: 400 },
            );
      }
      const { id, method, params = {} } = message.data;
      if (id === undefined) return new Response(null, { status: 202 });
      const context = { origin: origin(req) };
      return Response.json({
        jsonrpc: "2.0",
        id,
        ...(await answer(method, params, tools, instructions, context)),
      });
    },
  };
}
```

## The review tools

The tools work on the newest version of a local review, since that is the one
the reader is looking at. A comment names its commit by change id, the
[key](../frontend/review.md#review-state) a local review files comments
under, so it follows the change across the versions registered after it.
`read_comments` still marks a comment stale when the commit it was written on
is not in the newest version, because its line numbers may no longer match.

A review is the reader's turn until they mark its newest version reviewed,
and the agent's after; `review_status` and `list_reviews` say which. Open
comments do not make it the agent's turn, because the reader writes them
while still reading and only marking the version says they have finished.
`register_review` compares the version it adds with the one before, which is
what the agent just changed, while `review_status` compares the newest with
the last version the reader marked reviewed, which is what the reader has
yet to read. Both match commits by change id, as comments do.

Registering commits identical to the newest version's adds nothing. The
other option, a version identical to the last, would hand the reader a
comparison with nothing in it and turn a reviewed review back to them.

The link a tool hands back is for the reader, who opens it from another
machine. `just serve` knows the address it prints and passes it on as
`DIFFY_PUBLIC_URL`; anywhere else the link uses the address the agent called.

```ts
//| id: backend-agent-review
//| file: src/backend/agent/review.ts
import * as z from "zod";
import {
  type Anchor,
  type LocalReview,
  type LocalVersion,
  localReview,
  localSeries,
  type ReviewDocument,
  reviewedIn,
} from "../../frontend/model/review";
import { JjError, type JjLogEntry, jjCommits } from "../commit/jj";
import { RegistrationError, resolveRegistration } from "../review/local";
import type { ReviewStore } from "../review/store";
import { type Tool, ToolError, tool } from "./mcp";

export const AGENT = "claude";

export const INSTRUCTIONS = `diffy is where the reader reviews your work. When a piece of work is ready, register it with register_review under its bookmark and give the reader the link it returns. review_status says whose turn a review is: once the reader has marked the newest version reviewed, read_comments on it, answer or resolve what they wrote, amend the changes, and register_review again.`;

function reviewNamed(document: ReviewDocument, name: string): LocalReview {
  const review = localReview(document, name);
  if (review === undefined || review.versions.length === 0) {
    throw new ToolError(`no local review is named ${name}`);
  }
  return review;
}

function newest(document: ReviewDocument, name: string): LocalVersion {
  return reviewNamed(document, name).versions.at(-1) as LocalVersion;
}

/** Whose move a review waits on. The reader's until they mark the newest
 *  version reviewed, since marking is the one thing they do when done. */
function turnOf(
  document: ReviewDocument,
  review: LocalReview,
): { turn: "reader" | "agent"; newest: number; reviewed: number | null } {
  const newest = review.versions.length;
  const reviewed = Math.max(
    0,
    ...reviewedIn(document, localSeries(review.name)).map((mark) =>
      Number(mark.version),
    ),
  );
  return {
    turn: reviewed === newest ? "agent" : "reader",
    newest,
    reviewed: reviewed === 0 ? null : reviewed,
  };
}

function turnPhrase({ turn, newest, reviewed }: ReturnType<typeof turnOf>) {
  if (turn === "agent") return `your turn: the reader reviewed v${newest}`;
  const last = reviewed === null ? "" : `, v${reviewed} reviewed`;
  return `the reader's turn: v${newest} waits for review${last}`;
}

/** How a change stands against the same change id in an earlier version. */
type Since = "new" | "same" | "rewritten";

/** A version's commits, each against its change in `earlier`, and the
 *  changes `earlier` had that this version no longer does. A rewritten
 *  commit is hidden but still resolves by its full id. */
async function compare(
  version: LocalVersion,
  earlier: LocalVersion | undefined,
): Promise<{
  changes: { entry: JjLogEntry; since: Since | null }[];
  dropped: JjLogEntry[];
}> {
  const found = await jjCommits([
    ...new Set([...version.commits, ...(earlier?.commits ?? [])]),
  ]);
  const pick = (ids: string[]) => ids.flatMap((id) => found.get(id) ?? []);
  const now = pick(version.commits);
  const before = new Map(
    pick(earlier?.commits ?? []).map((entry) => [entry.changeId, entry]),
  );
  const kept = new Set(now.map((entry) => entry.changeId));
  return {
    changes: now.map((entry) => {
      const old = before.get(entry.changeId);
      const since: Since | null =
        earlier === undefined
          ? null
          : old === undefined
            ? "new"
            : old.commitId === entry.commitId
              ? "same"
              : "rewritten";
      return { entry, since };
    }),
    dropped: [...before.values()].filter((old) => !kept.has(old.changeId)),
  };
}

function link(origin: string, name: string): string {
  return `${origin}/reviews/${encodeURIComponent(name)}`;
}

function subject(entry: JjLogEntry): string {
  return entry.description.split("\n")[0] || "(no description)";
}

async function commitsOf(version: LocalVersion): Promise<JjLogEntry[]> {
  const found = await jjCommits(version.commits);
  return version.commits.flatMap((id) => found.get(id) ?? []);
}

function where(anchor: Anchor): string {
  switch (anchor.kind) {
    case "line":
      return `${anchor.path}:${anchor.line}${anchor.side === "before" ? " (before)" : ""}`;
    case "file":
      return anchor.path;
    case "comparison":
      return "whole commit";
  }
}

const Name = z.string().min(1).describe("the local review's name");

export function reviewTools(store: ReviewStore): Tool[] {
  return [
    tool({
      name: "register_review",
      description:
        "Register a new version of a local review for the reader, and answer with its link, its version number, and each change as new, same or rewritten against the version before. A new name reads trunk()..<name>; an existing one reads the revset of its last version. Commits identical to the newest version's register nothing.",
      input: z.object({
        name: Name.describe(
          "the local review's name, usually the bookmark of the work",
        ),
        revset: z
          .string()
          .min(1)
          .optional()
          .describe("the commits to review, oldest to newest"),
      }),
      call: async ({ name, revset }, { origin }) => {
        let version: LocalVersion;
        try {
          ({ version } = await resolveRegistration(
            store.read().document,
            { name, revset },
            new Date().toISOString(),
          ));
        } catch (error) {
          if (error instanceof RegistrationError || error instanceof JjError) {
            throw new ToolError(error.message);
          }
          throw error;
        }
        const before = localReview(store.read().document, name);
        const previous = before?.versions.at(-1);
        if (
          before?.forgottenAt === undefined &&
          previous !== undefined &&
          previous.commits.join() === version.commits.join()
        ) {
          return `${link(origin, name)}\nv${before?.versions.length} already has these commits, so nothing was registered`;
        }
        store.apply({ kind: "register", name, version });
        // Counted after the write: re-registering at the newest version's
        // operation replaces it rather than adding one.
        const number = reviewNamed(store.read().document, name).versions.length;
        const replaced = number === before?.versions.length;
        const earlier = replaced ? previous : before?.versions[number - 2];
        const { changes, dropped } = await compare(version, earlier);
        return [
          link(origin, name),
          replaced
            ? `v${number}, replacing the v${number} read at the same operation:`
            : earlier === undefined
              ? `v${number}:`
              : `v${number}, against v${number - 1}:`,
          ...changes.map(
            ({ entry, since }) =>
              `${entry.changeId.slice(0, 8)} ${entry.commitId.slice(0, 8)}${since === null ? "" : ` ${since}`} ${subject(entry)}`,
          ),
          ...dropped.map(
            (entry) =>
              `${entry.changeId.slice(0, 8)} dropped ${subject(entry)}`,
          ),
        ].join("\n");
      },
    }),
    tool({
      name: "list_reviews",
      description:
        "List the local reviews, each with its newest version, whose turn it is, and its link.",
      input: z.object({}),
      call: async (_input, { origin }) => {
        const { document } = store.read();
        const lines = document.localReviews
          .filter((review) => review.forgottenAt === undefined)
          .map(
            (review) =>
              `${review.name}: ${turnPhrase(turnOf(document, review))}, ${link(origin, review.name)}`,
          );
        return lines.length === 0 ? "no local reviews" : lines.join("\n");
      },
    }),
    tool({
      name: "review_status",
      description:
        "Say whose turn a local review is, as JSON: the reader's until they mark its newest version reviewed, then yours. Lists the versions the reader marked reviewed, and for each change of the newest version how it stands against the last reviewed version (new, same or rewritten), whether the reader marked it seen, and how many unresolved comments it has.",
      input: z.object({ name: Name }),
      call: async ({ name }, { origin }) => {
        const { document } = store.read();
        const review = reviewNamed(document, name);
        const turn = turnOf(document, review);
        const version = review.versions[turn.newest - 1] as LocalVersion;
        const { changes, dropped } = await compare(
          version,
          turn.reviewed === null
            ? undefined
            : review.versions[turn.reviewed - 1],
        );
        const open = (entry: JjLogEntry) =>
          document.comments.filter(
            (comment) =>
              !comment.resolved &&
              comment.reviewKey === `change:${entry.changeId}`,
          ).length;
        return JSON.stringify(
          {
            turn: turn.turn,
            status: turnPhrase(turn),
            newest: `v${turn.newest}`,
            link: link(origin, name),
            reviewed: reviewedIn(document, localSeries(name)).map((mark) => ({
              version: `v${mark.version}`,
              at: mark.reviewedAt,
            })),
            changes: changes.map(({ entry, since }) => ({
              change: entry.changeId.slice(0, 8),
              commit: entry.commitId.slice(0, 12),
              subject: subject(entry),
              sinceReviewed: since,
              // The reader's "mark seen" on this very commit, from any
              // version's comparison.
              seen: document.marks.some(
                (mark) =>
                  mark.reviewKey === `change:${entry.changeId}` &&
                  mark.toCommitId === entry.commitId,
              ),
              openComments: open(entry),
            })),
            droppedSinceReviewed: dropped.map((entry) => ({
              change: entry.changeId.slice(0, 8),
              subject: subject(entry),
            })),
          },
          null,
          2,
        );
      },
    }),
    tool({
      name: "read_comments",
      description:
        "Read the comments on the newest version of a local review, as JSON. Each names its change, where it sits, who wrote it, and whether it is resolved or stale.",
      input: z.object({
        name: Name,
        unresolvedOnly: z.boolean().default(true),
      }),
      call: async ({ name, unresolvedOnly }) => {
        const { document } = store.read();
        const version = newest(document, name);
        const commits = await commitsOf(version);
        const byKey = new Map(
          commits.flatMap((entry) => [
            [`change:${entry.changeId}`, entry],
            [`rev:${entry.commitId}`, entry],
          ]),
        );
        const comments = document.comments.flatMap((comment) => {
          const entry = byKey.get(comment.reviewKey);
          if (entry === undefined) return [];
          if (unresolvedOnly && comment.resolved) return [];
          return [
            {
              id: comment.id,
              author: comment.author,
              change: entry.changeId.slice(0, 8),
              subject: subject(entry),
              commit: comment.commitId.slice(0, 12),
              at: where(comment),
              body: comment.body,
              resolved: comment.resolved,
              stale: !version.commits.includes(comment.commitId),
            },
          ];
        });
        return JSON.stringify(comments, null, 2);
      },
    }),
    tool({
      name: "add_comment",
      description:
        "Comment on a change in the newest version of a local review: on a line of a file with path and line, on a whole file with path alone, or on the whole commit with neither.",
      input: z.object({
        name: Name,
        change: z
          .string()
          .min(1)
          .describe("a change id or commit id in the review, or a prefix"),
        path: z.string().min(1).optional(),
        line: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("a line number in the file as the commit leaves it"),
        side: z
          .enum(["before", "after"])
          .default("after")
          .describe("before for a line the commit removes"),
        body: z.string().min(1),
      }),
      call: async ({ name, change, path, line, side, body }) => {
        const version = newest(store.read().document, name);
        const matches = (await commitsOf(version)).filter(
          (entry) =>
            entry.changeId.startsWith(change) ||
            entry.commitId.startsWith(change),
        );
        const [entry, ...others] = matches;
        if (entry === undefined || others.length > 0) {
          throw new ToolError(
            `${change} names ${matches.length} commits of ${name}'s newest version, not one`,
          );
        }
        if (line !== undefined && path === undefined) {
          throw new ToolError("a line comment needs a path");
        }
        const anchor: Anchor =
          path === undefined
            ? { kind: "comparison" }
            : line === undefined
              ? { kind: "file", path }
              : { kind: "line", path, side, line };
        const id = crypto.randomUUID();
        store.apply({
          kind: "add-comment",
          comment: {
            id,
            reviewKey: `change:${entry.changeId}`,
            commitId: entry.commitId,
            body,
            resolved: false,
            createdAt: new Date().toISOString(),
            author: AGENT,
            replies: [],
            ...anchor,
          },
        });
        return id;
      },
    }),
    tool({
      name: "resolve_comment",
      description: "Resolve a comment, or reopen it with resolved false.",
      input: z.object({
        id: z.string().min(1),
        resolved: z.boolean().default(true),
      }),
      call: async ({ id, resolved }) => {
        if (!store.read().document.comments.some((each) => each.id === id)) {
          throw new ToolError(`no comment has id ${id}`);
        }
        store.apply({ kind: "resolve-comment", id, resolved });
        return resolved ? "resolved" : "reopened";
      },
    }),
  ];
}
```

## Tests

The tests call the route as Claude Code does, one JSON-RPC message per
`POST`, against a fresh store and diffy's own newest non-empty commit on
trunk.

```ts
//| id: backend-agent-test
//| file: src/backend/agent/review.test.ts
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
```
