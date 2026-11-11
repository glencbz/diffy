// ~/~ begin <<docs/architecture/backend/server.md#backend-server>>[init]

import * as z from "zod";
import { componentTools } from "./backend/agent/components";
import { evidenceTools } from "./backend/agent/evidence";
import {
  type AgentListeners,
  type Heard,
  LISTEN_PATH,
  type ReviewEvent,
} from "./backend/agent/listeners";
import { mcpRoute, type ToolContext, ToolError } from "./backend/agent/mcp";
import { recordingTools } from "./backend/agent/recording";
import { INSTRUCTIONS, reviewTools, turnOf } from "./backend/agent/review";
import { runTools } from "./backend/agent/runs";
import {
  beforePaths,
  CompareError,
  compareFiles,
} from "./backend/commit/compare";
import { gitBlob } from "./backend/commit/git";
import {
  JjError,
  type JjLogEntry,
  jjCommits,
  jjDiff,
  jjInterdiff,
  jjLog,
  jjOpLog,
} from "./backend/commit/jj";
import { playwrightRecorder } from "./backend/evidence/recorder";
import { EvidenceStore, evidenceRoutes } from "./backend/evidence/store";
import type { Host } from "./backend/host/host";
import { LayoutStore, layoutRoutes } from "./backend/layouts/layouts";
import {
  type DefaultRepo,
  type RecentRepos,
  type RepoContext,
  repoRoutes,
  type Workspaces,
} from "./backend/repo/repos";
import {
  localCommits,
  localDiff,
  localSize,
  RegistrationError,
  resolveRegistration,
} from "./backend/review/local";
import { highlightSource } from "./backend/syntax/highlight";
import index from "./frontend/index.html";
import { type AlignedPair, alignSeries } from "./model/alignment";
import type { ServedFileDiff } from "./model/diff";
import { BlobId, GitOid } from "./model/history";
import {
  localReview,
  localSeries,
  ReviewCommand,
  type ReviewDocument,
} from "./model/review";

/** Run a jj-backed handler body; a rejected revset/operation becomes a 400. */
async function jjJson(build: () => Promise<unknown>): Promise<Response> {
  try {
    return Response.json(await build());
  } catch (error) {
    if (error instanceof JjError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}

export function handleLog(
  req: Request,
  { root }: RepoContext,
): Promise<Response> {
  const params = new URL(req.url).searchParams;
  const atOperation = params.get("op") ?? undefined;
  const revset = params.get("revset") ?? undefined;
  return jjJson(() => jjLog(root, { revset, atOperation }));
}

export function handleOperations(
  _req: Request,
  { root }: RepoContext,
): Promise<Response> {
  // The one read that snapshots: live refresh sees an edit as an operation.
  return jjJson(() => jjOpLog(root, { limit: 200, snapshot: true }));
}
// ~/~ end
// ~/~ begin <<docs/architecture/backend/server.md#backend-server>>[1]

export async function handleInterdiff(
  req: Request,
  { root }: RepoContext,
): Promise<Response> {
  const params = new URL(req.url).searchParams;
  const from = params.getAll("from");
  const to = params.getAll("to");

  if (from.length === 0 && to.length === 0) {
    return Response.json(
      { error: "interdiff needs at least one commit" },
      { status: 400 },
    );
  }

  // Rows run concurrently, one jj process each.
  return jjJson(async () => {
    const commits = await jjCommits(root, [...from, ...to]);
    const series = (ids: string[]): JjLogEntry[] =>
      ids.flatMap((id) => {
        const commit = commits.get(id);
        return commit === undefined ? [] : [commit];
      });

    return {
      rows: await Promise.all(
        alignSeries(series(from), series(to)).map(async (pair) => ({
          ...pair,
          files: await pairFiles(root, pair),
        })),
      ),
    };
  });
}

/** A paired row is an interdiff; a lone commit is just its own diff. */
function pairFiles(
  root: string,
  pair: AlignedPair<JjLogEntry>,
): Promise<ServedFileDiff[]> {
  if (pair.from !== null && pair.to !== null) {
    return jjInterdiff(root, {
      from: pair.from.commitId,
      to: pair.to.commitId,
    });
  }

  const lone = pair.from ?? pair.to;
  return lone === null
    ? Promise.resolve([])
    : jjDiff(root, { revision: lone.commitId });
}
// ~/~ end
// ~/~ begin <<docs/architecture/backend/server.md#backend-server>>[2]

export async function handleSource(
  req: Request,
  { root }: RepoContext,
): Promise<Response> {
  const params = new URL(req.url).searchParams;
  const blob = BlobId.safeParse(params.get("blob"));
  const path = params.get("path");

  if (!blob.success || path === null || path === "") {
    return Response.json(
      { error: "source needs a blob id and a path" },
      { status: 400 },
    );
  }

  const text = await gitBlob(root, blob.data);
  if (text === null) {
    return Response.json(
      { error: `no blob ${blob.data} in the object store` },
      { status: 404 },
    );
  }

  return Response.json(await highlightSource(text, path));
}
// ~/~ end
// ~/~ begin <<docs/architecture/backend/server.md#backend-server>>[3]

const CompareParams = z.object({
  fromCommit: GitOid.nullable(),
  toCommit: GitOid,
});

function compareSides(params: URLSearchParams) {
  const { fromCommit, toCommit } = CompareParams.parse({
    fromCommit: params.get("fromCommit"),
    toCommit: params.get("toCommit"),
  });
  return { from: fromCommit, to: toCommit };
}

/** Run a compare handler body; a bad commit or path is the caller's to fix. */
async function compareJson(build: () => Promise<unknown>): Promise<Response> {
  try {
    return Response.json(await build());
  } catch (error) {
    if (error instanceof CompareError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof z.ZodError) {
      return Response.json({ error: z.prettifyError(error) }, { status: 400 });
    }
    throw error;
  }
}

export function handleCompare(
  req: Request,
  { root }: RepoContext,
): Promise<Response> {
  const params = new URL(req.url).searchParams;
  return compareJson(async () => {
    const oldPath = z.string().min(1).parse(params.get("oldPath"));
    const newPath = z.string().min(1).parse(params.get("newPath"));
    return {
      file: await compareFiles(root, compareSides(params), oldPath, newPath),
    };
  });
}

export function handleComparePaths(
  req: Request,
  { root }: RepoContext,
): Promise<Response> {
  const params = new URL(req.url).searchParams;
  return compareJson(async () => ({
    paths: await beforePaths(root, compareSides(params)),
  }));
}
// ~/~ end
// ~/~ begin <<docs/architecture/backend/server.md#backend-server>>[4]

export const reviewRoute = (listeners: Pick<AgentListeners, "tell">) => ({
  GET: (_req: Request, { store }: RepoContext) => Response.json(store.read()),
  POST: async (req: Request, { root, store }: RepoContext) => {
    const command = ReviewCommand.safeParse(
      await req.json().catch(() => undefined),
    );
    if (!command.success) {
      return Response.json(
        { error: z.prettifyError(command.error) },
        { status: 400 },
      );
    }
    const before = store.read().document;
    const document = store.apply(command.data);
    const event = eventOf(command.data, before, document.document);
    if (event !== null) {
      // The reader is not kept waiting on the agents' workspaces.
      void listeners.tell(root, event);
    }
    return Response.json(document);
  },
});

/** What a command tells the agents: a mark of a local review's newest
 *  version submits it, and forgetting one that was not forgotten deletes
 *  it. */
function eventOf(
  command: ReviewCommand,
  before: ReviewDocument,
  after: ReviewDocument,
): ReviewEvent | null {
  if (command.kind === "forget-review") {
    const review = localReview(before, command.name);
    if (review === undefined || review.forgottenAt !== undefined) return null;
    return { review: review.name, deleted: true };
  }
  if (command.kind !== "mark-reviewed") return null;
  const review = after.localReviews.find(
    (each) => localSeries(each.name) === command.series,
  );
  const version = Number(command.version);
  if (review === undefined || version !== review.versions.length) return null;
  return { review: review.name, version };
}
// ~/~ end
// ~/~ begin <<docs/architecture/backend/server.md#backend-server>>[5]

/** Who is at the other end of a socket: a screen, which hears its
 *  repository's store under `topic`, or an agent
 *  [waiting for the reader to submit](agents.md#telling-an-agent-the-reader-submitted),
 *  and what it hears at once when there is nothing to wait for. */
export type SocketData =
  | { kind: "screen"; topic: string }
  | {
      kind: "agent";
      root: string;
      review: string | null;
      now: Heard | null;
      stop?: () => void;
    };

export function reviewChanges(
  req: Request,
  server: Bun.Server<SocketData>,
  { topic }: RepoContext,
): Response | undefined {
  if (server.upgrade(req, { data: { kind: "screen", topic } })) {
    return undefined;
  }
  return Response.json({ error: "expected a WebSocket" }, { status: 400 });
}

/** `LISTEN_PATH`, for the agent in `workspace` waiting on `review`, or
 *  following every review when it names none. */
export function agentListen(
  context: (workspace: string) => Promise<RepoContext>,
) {
  return async (req: Request, server: Bun.Server<SocketData>) => {
    const asked = new URL(req.url).searchParams;
    const workspace = asked.get("workspace");
    const review = asked.get("review");
    if (workspace === null) {
      return Response.json({ error: "name a workspace" }, { status: 400 });
    }
    const data = await waiting(context, workspace, review);
    if (server.upgrade(req, { data })) return undefined;
    return Response.json({ error: "expected a WebSocket" }, { status: 400 });
  };
}

async function waiting(
  context: (workspace: string) => Promise<RepoContext>,
  workspace: string,
  review: string | null,
): Promise<SocketData> {
  const at = (now: Heard | null, root = workspace): SocketData => ({
    kind: "agent",
    root,
    review,
    now,
  });
  let repo: RepoContext;
  try {
    repo = await context(workspace);
  } catch (error) {
    return at({ error: (error as Error).message });
  }
  if (review === null) return at(null, repo.root);
  const { document } = repo.store.read();
  const named = localReview(document, review);
  if (named === undefined || named.versions.length === 0) {
    return at({ error: `no local review is named ${review}` });
  }
  if (named.forgottenAt !== undefined) {
    return at({ review, deleted: true }, repo.root);
  }
  const { turn, newest } = turnOf(document, named);
  return at(turn === "agent" ? { review, version: newest } : null, repo.root);
}

export function sockets(
  listeners: AgentListeners,
): Bun.WebSocketHandler<SocketData> {
  return {
    open(ws) {
      if (ws.data.kind === "screen") {
        ws.subscribe(ws.data.topic);
        return;
      }
      if (ws.data.now !== null) {
        ws.send(JSON.stringify(ws.data.now));
        return;
      }
      ws.data.stop = listeners.add({
        root: ws.data.root,
        review: ws.data.review,
        send: (line) => ws.send(line),
      });
    },
    close(ws) {
      if (ws.data.kind === "agent") ws.data.stop?.();
    },
    message() {},
  };
}
// ~/~ end
// ~/~ begin <<docs/architecture/backend/server.md#backend-server>>[6]

const RegistrationBody = z.object({
  name: z.string().min(1).optional(),
  revset: z.string().min(1).optional(),
  operation: z.string().min(1).optional(),
});

/** A local-review body; what the repository refuses becomes a 400. */
async function localJson(build: () => Promise<unknown>): Promise<Response> {
  try {
    return Response.json(await build());
  } catch (error) {
    if (
      error instanceof RegistrationError ||
      error instanceof JjError ||
      error instanceof z.ZodError
    ) {
      const message =
        error instanceof z.ZodError ? z.prettifyError(error) : error.message;
      return Response.json({ error: message }, { status: 400 });
    }
    throw error;
  }
}

export const localReviewsRoute = (now: () => Date) => ({
  POST: (req: Request, { root, store }: RepoContext) =>
    localJson(async () => {
      const asked = RegistrationBody.parse(await req.json().catch(() => ({})));
      const { name, version } = await resolveRegistration(
        root,
        store.read().document,
        asked,
        now().toISOString(),
      );
      return {
        name,
        snapshot: store.apply({ kind: "register", name, version }),
      };
    }),
});

export function handleLocalCommits(
  req: Request,
  { root }: RepoContext,
): Promise<Response> {
  const ids = new URL(req.url).searchParams.getAll("id");
  return localJson(() => localCommits(root, ids));
}

export function handleLocalDiff(
  req: Request,
  { root }: RepoContext,
): Promise<Response> {
  const params = new URL(req.url).searchParams;
  return localJson(async () => ({
    files: await localDiff(
      root,
      params.get("fromCommit"),
      params.get("toCommit"),
    ),
  }));
}

export function handleLocalSize(
  req: Request,
  { root }: RepoContext,
): Promise<Response> {
  const ids = new URL(req.url).searchParams.getAll("id");
  return localJson(async () => ({ files: await localSize(root, ids) }));
}
// ~/~ end
// ~/~ begin <<docs/architecture/backend/server.md#backend-server>>[7]

/** The workspace a browser request names in `?workspace=`, or the
 *  default repository's when it names none. A Response is the refusal. */
async function requested(
  req: Request,
  defaultRepo: DefaultRepo,
  workspaces: Workspaces,
): Promise<RepoContext | Response> {
  const named =
    new URL(req.url).searchParams.get("workspace") ?? defaultRepo.root;
  if (named === null) {
    return Response.json({ error: "no repository is open" }, { status: 409 });
  }
  return workspaces
    .context(named)
    .catch((error: Error) =>
      Response.json({ error: error.message }, { status: 404 }),
    );
}

type InRepo = (req: Request, repo: RepoContext) => Response | Promise<Response>;

export function routes(
  host: Host,
  defaultRepo: DefaultRepo,
  recent: RecentRepos,
  workspaces: Workspaces,
  listeners: AgentListeners,
) {
  const inRepo =
    (handle: InRepo) =>
    async (req: Request): Promise<Response> => {
      const repo = await requested(req, defaultRepo, workspaces);
      return repo instanceof Response ? repo : handle(req, repo);
    };
  const evidence = EvidenceStore.in(host.dataDir);
  const recorder = playwrightRecorder(host.browser);
  const publicOrigin = (req: Request) =>
    host.publicUrl ?? new URL(req.url).origin;
  const origins = (req: Request) => ({
    reader: publicOrigin(req),
    agent: new URL(req.url).origin,
  });
  return {
    "/*": index,
    ...repoRoutes(host, defaultRepo, recent),
    ...layoutRoutes(LayoutStore.in(host.dataDir)),
    ...evidenceRoutes(evidence),
    "/api/*": () => new Response("Not found", { status: 404 }),
    "/api/log": inRepo(handleLog),
    "/api/operations": inRepo(handleOperations),
    "/api/interdiff": inRepo(handleInterdiff),
    "/api/source": inRepo(handleSource),
    "/api/compare": inRepo(handleCompare),
    "/api/compare/paths": inRepo(handleComparePaths),
    "/api/review": {
      GET: inRepo(reviewRoute(listeners).GET),
      POST: inRepo(reviewRoute(listeners).POST),
    },
    "/api/review/changes": async (
      req: Request,
      server: Bun.Server<SocketData>,
    ) => {
      const repo = await requested(req, defaultRepo, workspaces);
      return repo instanceof Response ? repo : reviewChanges(req, server, repo);
    },
    "/api/local/reviews": { POST: inRepo(localReviewsRoute(host.now).POST) },
    "/api/local/commits": inRepo(handleLocalCommits),
    "/api/local/diff": inRepo(handleLocalDiff),
    "/api/local/size": inRepo(handleLocalSize),
    "/mcp": mcpRoute(
      [
        ...reviewTools(),
        ...componentTools(),
        ...evidenceTools(evidence),
        ...recordingTools(evidence, recorder),
        ...runTools(evidence, recorder),
      ],
      INSTRUCTIONS,
      (req, caller) =>
        agentContext(host, defaultRepo, workspaces, origins(req), caller),
    ),
    [LISTEN_PATH]: agentListen((workspace) => workspaces.context(workspace)),
  };
}
// ~/~ end
// ~/~ begin <<docs/architecture/backend/server.md#backend-server>>[8]

export async function agentContext(
  host: Pick<Host, "now" | "diffy">,
  defaultRepo: Pick<DefaultRepo, "root">,
  workspaces: Pick<Workspaces, "context">,
  origins: { reader: string; agent: string },
  caller: string | null,
): Promise<ToolContext> {
  const named = caller ?? defaultRepo.root;
  if (named === null) {
    throw new ToolError(
      "diffy has no repository open, and the agent named no workspace",
    );
  }
  const repo = await workspaces.context(named).catch((error: Error) => {
    throw new ToolError(error.message);
  });
  const query = `?repo=${encodeURIComponent(repo.root)}`;
  return {
    repo,
    link: (path) => `${origins.reader}${path}${query}`,
    wait: (name) =>
      [...host.diffy, "wait", name, "--url", origins.agent]
        .map(shellWord)
        .join(" "),
    now: host.now,
  };
}

function shellWord(word: string): string {
  return /^[\w@%+=:,./-]+$/.test(word)
    ? word
    : `'${word.replaceAll("'", `'\\''`)}'`;
}
// ~/~ end
