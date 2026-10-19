# Agents

An agent reaches the [review document](review-store.md) over MCP at `/mcp`, on
the same server the reader's browser uses. It registers its work as a
[local review](local-reviews.md), reads what the reader wrote on it, and
writes comments of its own, which the reader's screens hear about as they hear
about each other's writes.

## One server for every agent

The route is served by diffy itself, so every agent on the machine reaches
the same store the reader's browser writes, and the tools apply the same
commands to it as `/api/review`. A tool server of each session's own would
either open the store behind the server's back or call the HTTP API from a
second copy of the code.

An agent still runs a process of its own, but a thin one:
[`diffy mcp`](#the-stdio-bridge) carries its messages to the server, so its
config holds a command rather than the server's port, and the server learns
which workspace the agent works in. Its tools read and write that
workspace's repository and store, and the reader's browser keeps its own.
`register_review` still asks for a name and reads the bookmark of that name,
which an agent has by the time its work is ready, since
[registration](local-reviews.md#registering-a-version) reads a working copy
only for a review with no name.

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
import type { RepoContext } from "../repo/repos";

/** What a tool sees of the request that called it. */
export interface ToolContext {
  /** The workspace the calling agent works in. */
  repo: RepoContext;
  /** The link the reader opens a path of this server's at. */
  link: (path: string) => string;
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
  context: () => Promise<ToolContext>,
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
        const text = await found.call(input.data, await context());
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

/** Where `diffy mcp` names the workspace its agent
 *  runs in, URI-encoded since a path need not be ASCII. */
export const CALLER_HEADER = "Diffy-Workspace";

export function mcpRoute(
  tools: Tool[],
  instructions: string,
  /** The context a call runs in, from its request and the workspace the
   *  caller named. A thrown `ToolError` fails the call. */
  context: (req: Request, caller: string | null) => Promise<ToolContext>,
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
      const caller = req.headers.get(CALLER_HEADER);
      const named = caller === null ? null : decodeURIComponent(caller);
      return Response.json({
        jsonrpc: "2.0",
        id,
        ...(await answer(method, params, tools, instructions, () =>
          context(req, named),
        )),
      });
    },
  };
}
```

## The stdio bridge

`diffy mcp` speaks MCP's stdio transport to the agent, one JSON-RPC message
per line, and posts each line to the server's `/mcp`. Claude Code starts it in
the session's directory, so it names that jj workspace in every call, and
each tool call [runs in it](repos.md#an-agent-in-another-repository), whatever
repository the reader is looking at.

It finds the [per-user server](instance.md) again whenever a post fails, so a
server that restarted, even on a new port, is picked up without restarting
the agent. With no server up, the [command line](cli.md#diffy-mcp) starts one
in the background rather than failing: the link `register_review` hands back
is the reader's way into the review, and it has to open. Messages are relayed
as they come, so a slow call does not hold up the ones behind it; the answers
carry their ids.

```ts
//| id: backend-agent-bridge
//| file: src/backend/agent/bridge.ts
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
```

## The review tools

The tools work on the newest version of a local review, since that is the one
the reader is looking at. A comment names its commit by change id, the
[key](../frontend/review.md#review-state) a local review files comments
under, so it follows the change across the versions registered after it.
`read_comments` still marks a comment stale when the commit it was written on
is not in the newest version, because its line numbers may no longer match.
It answers with [threads](../frontend/review.md#review-state), so an agent
answers a comment with `reply_to_comment` on its thread rather than a comment
beside it, which the reader would have to resolve as well.

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
import { type Tool, ToolError, tool } from "./mcp";

export const AGENT = "claude";

export const INSTRUCTIONS = `diffy is where the reader reviews your work. When a piece of work is ready, register it with register_review under its bookmark, write that version's component map with write_components, using the kinds read_component_kinds lists and grouping the components into the parts a reader would check one at a time, and give the reader the link it returns. review_status says whose turn a review is: once the reader has marked the newest version reviewed, read_comments on it, answer each thread with reply_to_comment, resolve what your change settles, amend the changes, register_review again, and write the new version's map, keeping the ids read_components gives for the version before. The reader decides the kinds a map uses: when they ask to change them, do it with define_component_kind and remove_component_kind.`;

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
  root: string,
  version: LocalVersion,
  earlier: LocalVersion | undefined,
): Promise<{
  changes: { entry: JjLogEntry; since: Since | null }[];
  dropped: JjLogEntry[];
}> {
  const found = await jjCommits(root, [
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

function reviewPath(name: string): string {
  return `/reviews/${encodeURIComponent(name)}`;
}

function subject(entry: JjLogEntry): string {
  return entry.description.split("\n")[0] || "(no description)";
}

async function commitsOf(
  root: string,
  version: LocalVersion,
): Promise<JjLogEntry[]> {
  const found = await jjCommits(root, version.commits);
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

export function reviewTools(): Tool[] {
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
      call: async ({ name, revset }, { repo: { root, store }, link }) => {
        let version: LocalVersion;
        try {
          ({ version } = await resolveRegistration(
            root,
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
          return `${link(reviewPath(name))}\nv${before?.versions.length} already has these commits, so nothing was registered`;
        }
        store.apply({ kind: "register", name, version });
        // Counted after the write: re-registering at the newest version's
        // operation replaces it rather than adding one.
        const number = reviewNamed(store.read().document, name).versions.length;
        const replaced = number === before?.versions.length;
        const earlier = replaced ? previous : before?.versions[number - 2];
        const { changes, dropped } = await compare(root, version, earlier);
        return [
          link(reviewPath(name)),
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
      call: async (_input, { repo: { store }, link }) => {
        const { document } = store.read();
        const lines = document.localReviews
          .filter((review) => review.forgottenAt === undefined)
          .map(
            (review) =>
              `${review.name}: ${turnPhrase(turnOf(document, review))}, ${link(reviewPath(review.name))}`,
          );
        return lines.length === 0 ? "no local reviews" : lines.join("\n");
      },
    }),
    tool({
      name: "review_status",
      description:
        "Say whose turn a local review is, as JSON: the reader's until they mark its newest version reviewed, then yours. Lists the versions the reader marked reviewed, and for each change of the newest version how it stands against the last reviewed version (new, same or rewritten), whether the reader marked it seen, and how many unresolved comments it has.",
      input: z.object({ name: Name }),
      call: async ({ name }, { repo: { root, store }, link }) => {
        const { document } = store.read();
        const review = reviewNamed(document, name);
        const turn = turnOf(document, review);
        const version = review.versions[turn.newest - 1] as LocalVersion;
        const { changes, dropped } = await compare(
          root,
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
            link: link(reviewPath(name)),
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
        "Read the comment threads on the newest version of a local review, as JSON. Each names its change, where it sits, who wrote it, whether it is resolved or stale, and its replies, oldest first.",
      input: z.object({
        name: Name,
        unresolvedOnly: z.boolean().default(true),
      }),
      call: async ({ name, unresolvedOnly }, { repo: { root, store } }) => {
        const { document } = store.read();
        const version = newest(document, name);
        const commits = await commitsOf(root, version);
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
              replies: comment.replies.map(({ id, author, body }) => ({
                id,
                author,
                body,
              })),
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
      call: async (
        { name, change, path, line, side, body },
        { repo: { root, store } },
      ) => {
        const version = newest(store.read().document, name);
        const matches = (await commitsOf(root, version)).filter(
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
      name: "reply_to_comment",
      description:
        "Answer a comment on its thread, and answer with the reply's id. A reply reopens a resolved thread, so resolve after replying.",
      input: z.object({
        id: z
          .string()
          .min(1)
          .describe("the id of the comment that starts the thread"),
        body: z.string().min(1),
      }),
      call: async ({ id, body }, { repo: { store } }) => {
        if (!store.read().document.comments.some((each) => each.id === id)) {
          throw new ToolError(`no comment has id ${id}`);
        }
        const reply = crypto.randomUUID();
        store.apply({
          kind: "add-reply",
          commentId: id,
          reply: {
            id: reply,
            body,
            createdAt: new Date().toISOString(),
            author: AGENT,
          },
        });
        return reply;
      },
    }),
    tool({
      name: "resolve_comment",
      description: "Resolve a comment, or reopen it with resolved false.",
      input: z.object({
        id: z.string().min(1),
        resolved: z.boolean().default(true),
      }),
      call: async ({ id, resolved }, { repo: { store } }) => {
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

## Naming a series

A tool that writes to a series names it by `review` or `pull` and writes to
its newest version, the one the reader opens. A pull request's newest head is
read from GitHub and fetched the way the [pull request screen](github.md)
fetches it, and its commits are named by commit id, since git gives them no
change id. The tools read their series through `SeriesSources`, so a test can
stand a pull request in without asking GitHub.

```ts
//| id: backend-agent-series
//| file: src/backend/agent/series.ts
import * as z from "zod";
import {
  localReview,
  localSeries,
  pullSeries,
} from "../../frontend/model/review";
import { GitError, gitLog, gitMaterialize } from "../commit/git";
import {
  GitHubError,
  githubPullRequestHistory,
  originRepo,
  PullNumber,
  pullPins,
} from "../commit/github";
import { JjError, type JjFileDiff, jjCommits, jjDiff } from "../commit/jj";
import type { RepoContext } from "../repo/repos";
import { ToolError } from "./mcp";

/** A commit as a tool names it to the agent. A pull request's commits
 *  have no change ids, so they are named by commit id alone. */
export interface SeriesCommit {
  commitId: string;
  changeId: string | null;
  subject: string;
  /** The whole message, which a [component map](../frontend/components.md)
   *  quotes from. */
  description: string;
}

/** The newest version of a series, which is the one an agent writes to,
 *  since it is the one the reader opens. */
export interface SeriesTarget {
  series: string;
  version: string;
  /** How the agent is told which version: `v3`. */
  label: string;
  /** The path the reader reads the series at. */
  path: string;
  /** Oldest first. */
  commits: SeriesCommit[];
}

/** Where a tool reads a series and its commits from. */
export interface SeriesSources {
  local: (name: string) => Promise<SeriesTarget>;
  pull: (number: number) => Promise<SeriesTarget>;
  diff: (commitId: string) => Promise<JjFileDiff[]>;
}

function subject(description: string): string {
  return description.split("\n")[0] || "(no description)";
}

export function liveSources({ root, store }: RepoContext): SeriesSources {
  return {
    local: async (name) => {
      const review = localReview(store.read().document, name);
      const version = review?.versions.at(-1);
      if (review === undefined || version === undefined) {
        throw new ToolError(`no local review is named ${name}`);
      }
      const found = await jjCommits(root, version.commits);
      return {
        series: localSeries(name),
        version: String(review.versions.length),
        label: `v${review.versions.length}`,
        path: `/reviews/${encodeURIComponent(name)}`,
        commits: version.commits.flatMap((id) => {
          const entry = found.get(id);
          return entry === undefined
            ? []
            : [
                {
                  commitId: entry.commitId,
                  changeId: entry.changeId,
                  subject: subject(entry.description),
                  description: entry.description,
                },
              ];
        }),
      };
    },
    pull: async (number) => {
      const { owner, name } = await originRepo(root);
      const repo = `${owner}/${name}`;
      const history = await githubPullRequestHistory(
        { owner, name },
        PullNumber.parse(number),
      );
      const state = history.states.at(-1);
      if (state === undefined) throw new ToolError(`#${number} has no head`);
      const [base, tip] = await gitMaterialize(root, pullPins(history, state));
      if (base === undefined || tip === undefined) {
        throw new Error("gitMaterialize returned fewer oids than asked");
      }
      const commits = await gitLog(root, { from: base, to: tip, limit: 200 });
      return {
        series: pullSeries(repo, number),
        version: state.head,
        label: `v${state.version}`,
        path: `/pulls/${number}`,
        commits: commits.reverse().map((commit) => ({
          commitId: commit.commitId,
          changeId: null,
          subject: subject(commit.description),
          description: commit.description,
        })),
      };
    },
    diff: (commitId) => jjDiff(root, { revision: commitId }),
  };
}

/** The commit of `target` that `name` names, by a prefix of its change id
 *  or its commit id. */
export function commitNamed(target: SeriesTarget, name: string): SeriesCommit {
  const matches = target.commits.filter(
    (commit) =>
      commit.commitId.startsWith(name) ||
      (commit.changeId?.startsWith(name) ?? false),
  );
  const [only, ...others] = matches;
  if (only === undefined || others.length > 0) {
    throw new ToolError(
      `${name} names ${matches.length} commits of ${target.label}, not one`,
    );
  }
  return only;
}

export function short(commit: SeriesCommit): string {
  return (commit.changeId ?? commit.commitId).slice(0, 8);
}

export function pathsOf(file: JjFileDiff): string[] {
  return "path" in file ? [file.path] : [file.oldPath, file.newPath];
}

/** The lines a hunk spans on each side, as `[first, last]`. */

export const Target = {
  review: z
    .string()
    .min(1)
    .optional()
    .describe("the local review's name, for a local review"),
  pull: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("the pull request's number, for a pull request"),
};

export function targetOf(
  sources: SeriesSources,
  { review, pull }: { review?: string | undefined; pull?: number | undefined },
): Promise<SeriesTarget> {
  if ((review === undefined) === (pull === undefined)) {
    throw new ToolError("name one of review or pull");
  }
  const target =
    review !== undefined ? sources.local(review) : sources.pull(pull as number);
  return target.catch((error: unknown) => {
    if (
      error instanceof JjError ||
      error instanceof GitError ||
      error instanceof GitHubError
    ) {
      throw new ToolError(error.message);
    }
    throw error;
  });
}
```

## The component tools

A [component map](../frontend/components.md#the-component-map) is written to
the newest version of a series. `write_components` takes the whole map at
once, since a tool per component would leave a half-written map on the
reader's screen between calls. It refuses what would draw wrong and answers
with the changed lines no component claims, so the agent decides whether
they deserve one.

A mention has to be quoted exactly from its commit's message, since the
reader's screen finds it there by matching text. The tool checks each one
against the message rather than let a misquote leave a component that the
message never links to.

The same call takes the commit's groups, the parts of the change a reader
would check one at a time, which the rail
[arranges by](../frontend/components.md#arranging-a-commits-components). A
component sits in one group at most, so the rail's counts add up, and a
group naming a component the commit lacks is refused rather than drawn
short.

`read_components` reads a map back in the shape the tool takes, and reads an
older version's map too, so an agent writing a new version keeps the ids
that let a reader compare the two.

Each component is of a kind from the repository's vocabulary, which the
reader shapes in conversation with an agent through `define_component_kind`
and `remove_component_kind`. `read_component_kinds` gives an agent the kinds
with the advice on telling each apart, and `write_components` refuses any
other kind with the same list, so an agent that skipped the read learns the
vocabulary from the refusal. Listing the kinds in the tool's own schema would
be simpler, but a client reads the tool list once when it connects, and the
vocabulary changes in the middle of a conversation. A repository whose
vocabulary is emptied takes any kind.

The vocabulary lists each kind's colour, and a new kind is refused without
one. Left to default, a new kind would take whatever colour was free, and the
default kinds hold all seven, so the reader's own kinds would be grey. The
agent picks the reader's colour, or else one no kind is drawn in.

```ts
//| id: backend-agent-components
//| file: src/backend/agent/components.ts
import * as z from "zod";
import {
  type Component,
  type ComponentGroup,
  ComponentKind,
  type ComponentMap,
  ComponentPlace,
  ComponentRole,
  coloursOf,
  componentsTo,
  KindColour,
} from "../../frontend/model/components";
import { readPatch } from "../../frontend/model/patch";
import type { JjFileDiff } from "../commit/jj";
import type { RepoContext } from "../repo/repos";
import { type Tool, ToolError, tool } from "./mcp";
import { AGENT } from "./review";
import {
  commitNamed,
  liveSources,
  pathsOf,
  type SeriesSources,
  short,
  Target,
  targetOf,
} from "./series";

const ComponentInput = z.object({
  commit: z
    .string()
    .min(1)
    .describe(
      "the change id or commit id the component belongs to, or a prefix",
    ),
  id: z
    .string()
    .min(1)
    .describe(
      "a short slug for the component, the same in every version that has it, so versions can be compared",
    ),
  kind: z
    .string()
    .min(1)
    .describe(
      "what it is, in a word of the repository's vocabulary, which read_component_kinds lists with how to tell each",
    ),
  name: z
    .string()
    .min(1)
    .describe("its name, usually the identifier it is known by"),
  role: ComponentRole.describe(
    "what it does for the commit: implements, refactors, wires (passes things along) or tests",
  ),
  gist: z.string().default("").describe("what it does, in a sentence"),
  words: z
    .array(z.string())
    .default([])
    .describe("names in the code that mean this component, which link to it"),
  mentions: z
    .array(z.string())
    .default([])
    .describe(
      "phrases quoted exactly from the commit's message that describe this component, which link to it",
    ),
  places: z
    .array(ComponentPlace)
    .min(1)
    .describe(
      "the runs of changed lines that make it, in reading order: a path, lines start to end on side (after unless the lines were removed), what the place does in a few words, and, for code that moved, moves: the index of this component's place at the other end, on the other side",
    ),
});
type ComponentInput = z.infer<typeof ComponentInput>;

const GroupInput = z.object({
  commit: z
    .string()
    .min(1)
    .describe("the change id or commit id the group's components belong to"),
  id: z
    .string()
    .min(1)
    .describe("a short slug for the group, the same in every version"),
  name: z
    .string()
    .min(1)
    .describe("what the group is, in a few words, such as Stored replies"),
  gist: z.string().default("").describe("what the group does, in a sentence"),
  components: z
    .array(z.string().min(1))
    .min(1)
    .describe("the ids of this commit's components that make it"),
});

/** A file's changed lines on each side. */
function changedLines(file: JjFileDiff) {
  const before: number[] = [];
  const after: number[] = [];
  for (const hunk of readPatch(file.patch).hunks) {
    for (const line of hunk.lines) {
      if (line.kind === "added") after.push(line.newLine);
      if (line.kind === "removed") before.push(line.oldLine);
    }
  }
  return { before, after };
}

/** `lines` as `first-last` runs, at most `SHOWN` of them. */
const SHOWN = 4;
function runs(lines: number[]): string {
  const out: [number, number][] = [];
  for (const line of lines) {
    const last = out.at(-1);
    if (last !== undefined && last[1] === line - 1) last[1] = line;
    else out.push([line, line]);
  }
  const shown = out
    .slice(0, SHOWN)
    .map(([first, last]) => (first === last ? `${first}` : `${first}-${last}`));
  const more = out.length - SHOWN;
  return `${shown.join(", ")}${more > 0 ? ` and ${more} more` : ""}`;
}

const spaced = (text: string) => text.replace(/\s+/g, " ");

/** Why `input` cannot be drawn on its commit, or null. */
function refusal(
  input: ComponentInput,
  files: JjFileDiff[],
  message: string,
): string | null {
  const paths = new Set(files.flatMap(pathsOf));
  for (const [index, place] of input.places.entries()) {
    if (!paths.has(place.path)) {
      return `${input.id}'s commit does not change ${place.path}`;
    }
    if (place.end !== undefined && place.end < place.start) {
      return `place ${index} of ${input.id} ends at ${place.end}, before it starts`;
    }
    if (
      place.moves !== undefined &&
      (place.moves === index || place.moves >= input.places.length)
    ) {
      return `place ${index} of ${input.id} moves to place ${place.moves}, which is not another of its places`;
    }
    // One end of a move removes the code and the other adds it, which is how
    // the reader is told which way it went.
    if (
      place.moves !== undefined &&
      input.places[place.moves]?.side === place.side
    ) {
      return `place ${index} of ${input.id} moves to place ${place.moves} on the same side; a move goes from removed lines to added ones`;
    }
  }
  const quoted = spaced(message);
  const missing = input.mentions.find(
    (phrase) => !quoted.includes(spaced(phrase)),
  );
  if (missing !== undefined) {
    return `the message of ${input.id}'s commit does not say "${missing}"`;
  }
  return null;
}

/** The changed lines of `files` no place of `components` covers, one line
 *  per file. */
function unclaimed(files: JjFileDiff[], components: Component[]): string[] {
  return files.flatMap((file) => {
    const paths = pathsOf(file);
    const places = components.flatMap((each) =>
      each.places.filter((place) => paths.includes(place.path)),
    );
    const covered = (side: "before" | "after", line: number) =>
      places.some(
        (place) =>
          place.side === side &&
          line >= place.start &&
          line <= (place.end ?? place.start),
      );
    const { before, after } = changedLines(file);
    const added = after.filter((line) => !covered("after", line));
    const removed = before.filter((line) => !covered("before", line));
    if (added.length === 0 && removed.length === 0) return [];
    return [
      `${paths.at(-1) ?? ""}:${added.length > 0 ? ` added ${runs(added)}` : ""}${removed.length > 0 ? ` removed ${runs(removed)}` : ""}`,
    ];
  });
}

/** The vocabulary, a kind to a line with its colour and how to tell it. */
function vocabulary(kinds: ComponentKind[]): string {
  if (kinds.length === 0) {
    return "this repository has no vocabulary, so a component can be of any kind";
  }
  const colours = coloursOf(kinds);
  return kinds
    .map(
      (kind) =>
        `${kind.name} (${colours.get(kind.name)})${kind.advice === "" ? "" : `: ${kind.advice}`}`,
    )
    .join("\n");
}

export function componentTools(
  sourcesOf: (repo: RepoContext) => SeriesSources = liveSources,
): Tool[] {
  return [
    tool({
      name: "write_components",
      description:
        "Write the component map of the newest version of a local review or a pull request, replacing any map of that version: for each commit, the components it builds, each of a kind from the repository's vocabulary (read_component_kinds), and the changed lines that make each one, and the groups those components form. Keep a component's id from version to version, so the reader is told what is new, gone or changed. Answers with the reader's link and the changed lines no component claims.",
      input: z.object({
        ...Target,
        components: z.array(ComponentInput).min(1),
        groups: z
          .array(GroupInput)
          .default([])
          .describe(
            "each commit's components grouped into the parts of the change a reader would check one at a time, such as the stored data, the command that changes it and the view that draws it; a component is in one group at most",
          ),
      }),
      call: async ({ review, pull, components, groups }, { repo, link }) => {
        const { store } = repo;
        const sources = sourcesOf(repo);
        const kinds = store.read().document.componentKinds;
        const unknown = components.find(
          (input) =>
            kinds.length > 0 && !kinds.some((kind) => kind.name === input.kind),
        );
        if (unknown !== undefined) {
          throw new ToolError(
            `${unknown.id} is a ${unknown.kind}, which is not a kind this repository uses. Its kinds are:\n${vocabulary(kinds)}`,
          );
        }
        const target = await targetOf(sources, { review, pull });
        const resolved = components.map(
          ({ commit, ...rest }): Component => ({
            ...rest,
            commitId: commitNamed(target, commit).commitId,
          }),
        );

        const missed: string[] = [];
        for (const commit of target.commits) {
          const own = resolved.filter(
            (component) => component.commitId === commit.commitId,
          );
          if (own.length === 0) {
            missed.push(`${short(commit)} has no components`);
            continue;
          }
          const ids = own.map((component) => component.id);
          const twice = ids.find((id, index) => ids.indexOf(id) !== index);
          if (twice !== undefined) {
            throw new ToolError(
              `${short(commit)} has two components named ${twice}`,
            );
          }
          const files = await sources.diff(commit.commitId);
          for (const input of components) {
            if (
              commitNamed(target, input.commit).commitId !== commit.commitId
            ) {
              continue;
            }
            const why = refusal(input, files, commit.description);
            if (why !== null) throw new ToolError(why);
          }
          for (const line of unclaimed(files, own)) {
            missed.push(`${short(commit)} ${line}`);
          }
        }

        const placed = new Set<string>();
        const named = new Set<string>();
        const grouped = groups.map(({ commit, ...rest }): ComponentGroup => {
          const commitId = commitNamed(target, commit).commitId;
          const label = short(commitNamed(target, commit));
          if (named.has(`${commitId}:${rest.id}`)) {
            throw new ToolError(`${label} has two groups named ${rest.id}`);
          }
          named.add(`${commitId}:${rest.id}`);
          for (const id of rest.components) {
            if (
              !resolved.some(
                (component) =>
                  component.commitId === commitId && component.id === id,
              )
            ) {
              throw new ToolError(
                `group ${rest.id} names ${id}, which is not a component of ${label}`,
              );
            }
            if (placed.has(`${commitId}:${id}`)) {
              throw new ToolError(
                `${id} is in two groups of ${label}; a component is in one group at most`,
              );
            }
            placed.add(`${commitId}:${id}`);
          }
          return { ...rest, commitId };
        });

        const map: ComponentMap = {
          series: target.series,
          version: target.version,
          author: AGENT,
          writtenAt: new Date().toISOString(),
          components: resolved,
          groups: grouped,
        };
        store.apply({ kind: "write-components", map });
        return [
          link(target.path),
          `the components of ${target.label}: ${resolved.length} over ${new Set(resolved.map((component) => component.commitId)).size} of ${target.commits.length} commits`,
          ...(missed.length === 0
            ? ["every changed line belongs to a component"]
            : ["no component claims:", ...missed.map((line) => `  ${line}`)]),
        ].join("\n");
      },
    }),
    tool({
      name: "read_components",
      description:
        "Read the component map of the newest version of a local review or a pull request as JSON, in the shape write_components takes, so it can be edited and written back. Read the previous version's map before writing a new one, to keep its ids.",
      input: z.object({
        ...Target,
        version: z
          .string()
          .optional()
          .describe("an older version to read instead, such as v1"),
      }),
      call: async ({ review, pull, version }, { repo }) => {
        const { store } = repo;
        const target = await targetOf(sourcesOf(repo), { review, pull });
        const asked =
          version === undefined
            ? target.version
            : review !== undefined
              ? version.replace(/^v/, "")
              : null;
        if (asked === null) {
          throw new ToolError(
            "an older version of a pull request is read by its newest only",
          );
        }
        const map = componentsTo(
          store.read().document.componentMaps,
          target.series,
          asked,
        );
        if (map === undefined) {
          return `${version ?? target.label} has no component map yet`;
        }
        const names = new Map(
          target.commits.map((commit) => [commit.commitId, short(commit)]),
        );
        return JSON.stringify(
          {
            components: map.components.map(({ commitId, ...component }) => ({
              commit: names.get(commitId) ?? commitId,
              ...component,
            })),
            groups: map.groups.map(({ commitId, ...group }) => ({
              commit: names.get(commitId) ?? commitId,
              ...group,
            })),
          },
          null,
          2,
        );
      },
    }),
    tool({
      name: "read_component_kinds",
      description:
        "Read this repository's vocabulary of component kinds, each with advice on how to tell a component of that kind. Read it before writing a component map, and use only these kinds.",
      input: z.object({}),
      call: async (_input, { repo: { store } }) =>
        vocabulary(store.read().document.componentKinds),
    }),
    tool({
      name: "define_component_kind",
      description:
        "Add a kind to this repository's vocabulary of component kinds, or change the advice, colour or place of one it has. The reader decides the vocabulary: define a kind when they ask for one. A new kind needs a colour: take the one the reader names, or else one no other kind is drawn in, and tell the reader which. Answers with the whole vocabulary and each kind's colour.",
      input: z.object({
        name: ComponentKind.shape.name.describe(
          "the kind, one lowercase word, such as controller",
        ),
        advice: z
          .string()
          .min(1)
          .optional()
          .describe(
            "how to tell a component of this kind from the others, written to the agent that will map a change; a new kind needs it, and leaving it out keeps a kind's advice",
          ),
        colour: KindColour.optional().describe(
          "the colour it is drawn in; a new kind needs one, and leaving it out keeps a kind's colour",
        ),
        before: z
          .string()
          .optional()
          .describe(
            "the kind to place it just before; without one a new kind goes last and a kind already there stays where it is",
          ),
      }),
      call: async ({ name, advice, colour, before }, { repo: { store } }) => {
        const kinds = store.read().document.componentKinds;
        const kept = kinds.find((kind) => kind.name === name);
        const told = advice ?? kept?.advice;
        const drawn = colour ?? kept?.colour;
        if (kept === undefined && (told === undefined || drawn === undefined)) {
          throw new ToolError(
            `${name} is a new kind, so it needs advice and a colour. The colours taken are:\n${vocabulary(kinds)}`,
          );
        }
        if (
          before !== undefined &&
          !kinds.some((kind) => kind.name === before)
        ) {
          throw new ToolError(
            `${before} is not a kind this repository uses. Its kinds are:\n${vocabulary(kinds)}`,
          );
        }
        const { document } = store.apply({
          kind: "define-kind",
          name,
          advice: told ?? "",
          ...(drawn === undefined ? {} : { colour: drawn }),
          before,
        });
        return vocabulary(document.componentKinds);
      },
    }),
    tool({
      name: "remove_component_kind",
      description:
        "Remove a kind from this repository's vocabulary of component kinds, when the reader asks. Maps already written keep it, drawn grey. Answers with the whole vocabulary.",
      input: z.object({ name: z.string().min(1) }),
      call: async ({ name }, { repo: { store } }) => {
        const kinds = store.read().document.componentKinds;
        if (!kinds.some((kind) => kind.name === name)) {
          throw new ToolError(
            `${name} is not a kind this repository uses. Its kinds are:\n${vocabulary(kinds)}`,
          );
        }
        const { document } = store.apply({ kind: "remove-kind", name });
        return vocabulary(document.componentKinds);
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

/** The repository these tests read. */
const ROOT = process.cwd();

let dir: string;
let store: ReviewStore;
let route: ReturnType<typeof mcpRoute>;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "diffy-agent-"));
  store = openReviewStore(join(dir, "r.sqlite"));
  const repo = { root: ROOT, store };
  route = mcpRoute(reviewTools(), INSTRUCTIONS, async () => ({
    repo,
    link: (path) => `https://vm:4000${path}`,
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
    const [tip] = await jjLog(ROOT, { revset: TIP });
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
    const [tip] = await jjLog(ROOT, { revset: TIP });
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
    const [tip] = await jjLog(ROOT, { revset: TIP });
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

  test("threads a reply under the reader's comment", async () => {
    // arrange
    const [tip] = await jjLog(ROOT, { revset: TIP });
    if (tip === undefined) throw new Error("no history");
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

```ts
//| id: backend-agent-components-test
//| file: src/backend/agent/components.test.ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openReviewStore, type ReviewStore } from "../review/store";
import { componentTools } from "./components";

import { mcpRoute } from "./mcp";
import { INSTRUCTIONS } from "./review";
import type { SeriesSources } from "./series";

let dir: string;
let store: ReviewStore;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "diffy-components-"));
  store = openReviewStore(join(dir, "r.sqlite"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const PATCH = `diff --git a/a.ts b/a.ts
index 1111111..2222222 100644
--- a/a.ts
+++ b/a.ts
@@ -1,3 +1,3 @@
 one
-two
+TWO
 three
@@ -20,2 +20,3 @@
 twenty
+twenty-one
 twenty-two
`;

/** A pull request of one commit that changes `a.ts` in two places. */
const PULL: SeriesSources = {
  local: () => Promise.reject(new Error("not asked")),
  pull: async (number) => ({
    series: `pull:o/r#${number}`,
    version: "h".repeat(40),
    label: "v2",
    path: `/pulls/${number}`,
    commits: [
      {
        commitId: "aaaa1111",
        changeId: null,
        subject: "louder",
        description: "louder\n\nMake two louder, and add a\ntwenty-first line.",
      },
    ],
  }),
  diff: async () => [
    {
      status: "modified",
      path: "a.ts",
      binary: false,
      oldBlob: "1111111",
      newBlob: "2222222",
      patch: PATCH,
      structural: { kind: "unavailable", reason: "test" },
    },
  ],
};

let nextId = 1;

async function call(
  name: string,
  args: Record<string, unknown>,
): Promise<{ text: string; isError: boolean }> {
  const route = mcpRoute(
    componentTools(() => PULL),
    INSTRUCTIONS,
    async () => ({
      repo: { root: "/repo", store },
      link: (path) => `https://vm:4000${path}`,
    }),
  );
  const res = await route.POST(
    new Request("http://localhost/mcp", {
      method: "POST",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: nextId++,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    }),
  );
  const body = (await res.json()) as {
    result: { content: { text: string }[]; isError?: boolean };
  };
  return {
    text: body.result.content[0]?.text ?? "",
    isError: body.result.isError ?? false,
  };
}

const LOUDER = {
  commit: "aaaa",
  id: "louder",
  kind: "helper",
  name: "TWO",
  role: "refactors",
  mentions: ["Make two louder"],
  places: [
    { path: "a.ts", side: "before", start: 2, about: "the old name", moves: 1 },
    { path: "a.ts", start: 2, about: "the new name", moves: 0 },
  ],
};

describe("the component tools", () => {
  test("write a map and say which changed lines no component claims", async () => {
    // arrange
    // act
    const written = await call("write_components", {
      pull: 7,
      components: [LOUDER],
    });

    // assert
    expect(written).toEqual({
      text: [
        "https://vm:4000/pulls/7",
        "the components of v2: 1 over 1 of 1 commits",
        "no component claims:",
        "  aaaa1111 a.ts: added 21",
      ].join("\n"),
      isError: false,
    });
    const [map] = store.read().document.componentMaps;
    expect(map?.series).toBe("pull:o/r#7");
    expect(map?.components[0]?.commitId).toBe("aaaa1111");
  });

  test("read a map back in the shape it was written", async () => {
    // arrange
    await call("write_components", { pull: 7, components: [LOUDER] });

    // act
    const read = await call("read_components", { pull: 7 });

    // assert
    const [component] = JSON.parse(read.text).components;
    expect(component).toMatchObject({ ...LOUDER, commit: "aaaa1111" });
  });

  test("refuse a mention the commit's message does not make", async () => {
    // arrange
    const quoted = { ...LOUDER, mentions: ["make three quieter"] };

    // act
    const written = await call("write_components", {
      pull: 7,
      components: [quoted],
    });

    // assert
    expect(written.isError).toBe(true);
    expect(written.text).toContain('does not say "make three quieter"');
    expect(store.read().document.componentMaps).toEqual([]);
  });

  test("refuse a move between two places on the same side", async () => {
    // arrange
    const sideways = {
      ...LOUDER,
      places: [
        { path: "a.ts", start: 2, moves: 1 },
        { path: "a.ts", start: 21, moves: 0 },
      ],
    };

    // act
    const written = await call("write_components", {
      pull: 7,
      components: [sideways],
    });

    // assert
    expect(written.isError).toBe(true);
    expect(written.text).toContain("on the same side");
  });

  test("refuse a move to a place the component does not have", async () => {
    // arrange
    const stray = {
      ...LOUDER,
      places: [{ path: "a.ts", start: 2, moves: 3 }],
    };

    // act
    const written = await call("write_components", {
      pull: 7,
      components: [stray],
    });

    // assert
    expect(written.isError).toBe(true);
    expect(written.text).toContain("moves to place 3");
  });

  test("write groups and read them back", async () => {
    // arrange
    const group = {
      commit: "aaaa",
      id: "names",
      name: "Louder names",
      gist: "Every name says it louder.",
      components: ["louder"],
    };

    // act
    await call("write_components", {
      pull: 7,
      components: [LOUDER],
      groups: [group],
    });
    const read = await call("read_components", { pull: 7 });

    // assert
    const { commit: _, ...stored } = group;
    expect(store.read().document.componentMaps[0]?.groups).toEqual([
      { ...stored, commitId: "aaaa1111" },
    ]);
    expect(JSON.parse(read.text).groups).toEqual([
      { ...group, commit: "aaaa1111" },
    ]);
  });

  test("refuse a group of a component the commit does not have", async () => {
    // arrange
    // act
    const written = await call("write_components", {
      pull: 7,
      components: [LOUDER],
      groups: [{ commit: "aaaa", id: "g", name: "G", components: ["quiet"] }],
    });

    // assert
    expect(written.isError).toBe(true);
    expect(written.text).toContain("not a component of aaaa1111");
    expect(store.read().document.componentMaps).toEqual([]);
  });

  test("refuse a component in two groups", async () => {
    // arrange
    const twice = (id: string) => ({
      commit: "aaaa",
      id,
      name: id,
      components: ["louder"],
    });

    // act
    const written = await call("write_components", {
      pull: 7,
      components: [LOUDER],
      groups: [twice("a"), twice("b")],
    });

    // assert
    expect(written.isError).toBe(true);
    expect(written.text).toContain("louder is in two groups");
  });
});

describe("the vocabulary tools", () => {
  test("refuse a kind the repository does not use, and say which it does", async () => {
    // arrange
    const model = { ...LOUDER, kind: "model" };

    // act
    const written = await call("write_components", {
      pull: 7,
      components: [model],
    });

    // assert
    expect(written.isError).toBe(true);
    expect(written.text).toContain(
      "louder is a model, which is not a kind this repository uses",
    );
    expect(written.text).toContain("\nview (green): Code that draws");
    expect(store.read().document.componentMaps).toEqual([]);
  });

  test("define a kind a map can then use", async () => {
    // arrange
    // act
    const defined = await call("define_component_kind", {
      name: "model",
      advice: "A class that holds the app's data and rules.",
      colour: "blue",
    });
    const written = await call("write_components", {
      pull: 7,
      components: [{ ...LOUDER, kind: "model" }],
    });

    // assert
    expect(defined.text.split("\n").at(-1)).toBe(
      "model (blue): A class that holds the app's data and rules.",
    );
    expect(written.isError).toBe(false);
  });

  test("replace a kind's advice or colour where it stands, keeping the other", async () => {
    // arrange
    // act
    const advised = await call("define_component_kind", {
      name: "schema",
      advice: "A table.",
    });
    const coloured = await call("define_component_kind", {
      name: "schema",
      colour: "red",
    });

    // assert
    expect(advised.text.split("\n")[0]).toBe("schema (ink): A table.");
    expect(coloured.text.split("\n")[0]).toBe("schema (red): A table.");
    expect(store.read().document.componentKinds).toHaveLength(8);
  });

  test("refuse a new kind with no colour, and say which colours are taken", async () => {
    // arrange
    // act
    const defined = await call("define_component_kind", {
      name: "model",
      advice: "Holds data.",
    });

    // assert
    expect(defined.isError).toBe(true);
    expect(defined.text).toContain("model is a new kind");
    expect(defined.text).toContain("\nwiring (grey)");
  });

  test("place a kind before another", async () => {
    // arrange
    // act
    const placed = await call("define_component_kind", {
      name: "controller",
      advice: "Answers a request.",
      colour: "teal",
      before: "schema",
    });
    const stray = await call("define_component_kind", {
      name: "model",
      advice: "Holds data.",
      colour: "blue",
      before: "nothing",
    });

    // assert
    expect(placed.text.split("\n")[0]).toBe(
      "controller (teal): Answers a request.",
    );
    expect(stray.isError).toBe(true);
  });

  test("refuse a kind that is not a slug", async () => {
    // arrange
    // act
    const defined = await call("define_component_kind", {
      name: "Big Model",
      advice: "A class.",
      colour: "blue",
    });

    // assert
    expect(defined.isError).toBe(true);
  });

  test("remove a kind, and refuse one the repository does not have", async () => {
    // arrange
    // act
    const removed = await call("remove_component_kind", { name: "styles" });
    const again = await call("remove_component_kind", { name: "styles" });

    // assert
    expect(removed.text).not.toContain("styles");
    expect(again.isError).toBe(true);
    expect(again.text).toContain("styles is not a kind this repository uses");
  });

  test("let a repository with no vocabulary use any kind", async () => {
    // arrange
    for (const { name } of store.read().document.componentKinds) {
      await call("remove_component_kind", { name });
    }

    // act
    const read = await call("read_component_kinds", {});
    const written = await call("write_components", {
      pull: 7,
      components: [{ ...LOUDER, kind: "anything" }],
    });

    // assert
    expect(read.text).toContain("no vocabulary");
    expect(written.isError).toBe(false);
  });
});
```

The bridge's tests run it against a real `mcpRoute` with one made-up tool,
since what they check is the relay, not the tools.

```ts
//| id: backend-agent-bridge-test
//| file: src/backend/agent/bridge.test.ts
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
```
