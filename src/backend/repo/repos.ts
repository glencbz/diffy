// ~/~ begin <<docs/architecture/backend/repos.md#backend-repos>>[init]
import { mkdir, readdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { $ } from "bun";
import * as z from "zod";
import { jjRepoDir } from "../commit/jj";
import type { Host } from "../host/host";
import {
  openReviewStore,
  purgeForgotten,
  type ReviewStore,
  reviewStorePath,
  watchReview,
} from "../review/store";

/** One workspace a request reads and writes: where its jj and git
 *  commands run, and its repository's review store. */
export interface RepoContext {
  root: string;
  store: ReviewStore;
}

/** The repository the reader is shown, which every browser route reads. */
export class ServedRepo {
  #current: { context: RepoContext; stop: () => void } | null = null;
  /** Where the run started, while diffy serves a repository from the recent
   *  list in its place. */
  startedOutside: string | null = null;

  constructor(
    private readonly host: Host,
    private readonly recent: RecentRepos,
    private readonly publish: (revision: number) => void,
  ) {}

  get root(): string | null {
    return this.#current?.context.root ?? null;
  }

  /** The reader's context, or null before a repository is open. */
  context(): RepoContext | null {
    return this.#current?.context ?? null;
  }

  async open(root: string, startedOutside: string | null = null) {
    const store = openReviewStore(
      await reviewStorePath(root, this.host.dataDir),
    );
    this.#current?.stop();
    const stopWatch = watchReview(store, this.publish);
    const stopPurge = purgeForgotten(store, this.host.now);
    this.#current = {
      context: { root, store },
      stop: () => {
        stopWatch();
        stopPurge();
        store.close();
      },
    };
    this.startedOutside = startedOutside;
    await this.recent.opened(root, this.host.now().toISOString());
  }
}
// ~/~ end
// ~/~ begin <<docs/architecture/backend/repos.md#backend-repos>>[1]

/** What a path turned out to be, by the root of the repository holding it. */
export type Probe =
  | { kind: "jj"; root: string }
  | { kind: "git"; root: string }
  | { kind: "none" };

export function expandHome(path: string, home: string): string {
  if (path === "~") return home;
  if (path.startsWith("~/")) return join(home, path.slice(2));
  return resolve(path);
}

export async function probeRepo(path: string, home: string): Promise<Probe> {
  const dir = expandHome(path, home);
  const isDir = await stat(dir).then(
    (found) => found.isDirectory(),
    () => false,
  );
  if (!isDir) return { kind: "none" };
  const jj = await $`jj --ignore-working-copy workspace root`
    .cwd(dir)
    .quiet()
    .nothrow();
  if (jj.exitCode === 0)
    return { kind: "jj", root: jj.stdout.toString().trim() };
  const git = await $`git rev-parse --show-toplevel`.cwd(dir).quiet().nothrow();
  if (git.exitCode === 0) {
    return { kind: "git", root: git.stdout.toString().trim() };
  }
  return { kind: "none" };
}
// ~/~ end
// ~/~ begin <<docs/architecture/backend/repos.md#backend-repos>>[2]

export type Start =
  | { kind: "open"; root: string; startedOutside: string | null }
  | { kind: "choose"; startedOutside: string }
  | { kind: "fail"; reason: string };

export async function startingRepo(
  given: string | undefined,
  cwd: string,
  recent: RecentEntry[],
  probe: (path: string) => Promise<Probe>,
): Promise<Start> {
  if (given !== undefined) {
    const found = await probe(given);
    switch (found.kind) {
      case "jj":
        return { kind: "open", root: found.root, startedOutside: null };
      case "git":
        return {
          kind: "fail",
          reason: `${found.root} is a Git repository without jj; run jj git init --colocate there`,
        };
      case "none":
        return { kind: "fail", reason: `no jj repository at ${given}` };
    }
  }
  const here = await probe(cwd);
  if (here.kind === "jj") {
    return { kind: "open", root: here.root, startedOutside: null };
  }
  for (const entry of recent) {
    const found = await probe(entry.root);
    if (found.kind === "jj") {
      return { kind: "open", root: found.root, startedOutside: cwd };
    }
  }
  return { kind: "choose", startedOutside: cwd };
}
// ~/~ end
// ~/~ begin <<docs/architecture/backend/repos.md#backend-repos>>[3]

export const RecentEntry = z.object({
  root: z.string(),
  openedAt: z.string(),
});
export type RecentEntry = z.infer<typeof RecentEntry>;

const RECENT_LIMIT = 20;

export function withOpened(
  list: RecentEntry[],
  root: string,
  at: string,
): RecentEntry[] {
  return [
    { root, openedAt: at },
    ...list.filter((entry) => entry.root !== root),
  ].slice(0, RECENT_LIMIT);
}

export function withRestored(
  list: RecentEntry[],
  restored: RecentEntry,
): RecentEntry[] {
  return [...list.filter((entry) => entry.root !== restored.root), restored]
    .sort((a, b) => b.openedAt.localeCompare(a.openedAt))
    .slice(0, RECENT_LIMIT);
}

export class RecentRepos {
  constructor(private readonly path: string) {}

  static in(dataDir: string): RecentRepos {
    return new RecentRepos(join(dataDir, "recent.json"));
  }

  async read(): Promise<RecentEntry[]> {
    const file = Bun.file(this.path);
    if (!(await file.exists())) return [];
    const parsed = z
      .array(RecentEntry)
      .safeParse(await file.json().catch(() => null));
    return parsed.success ? parsed.data : [];
  }

  async opened(root: string, at: string): Promise<void> {
    await this.#write(withOpened(await this.read(), root, at));
  }

  async forget(root: string): Promise<RecentEntry | null> {
    const list = await this.read();
    await this.#write(list.filter((entry) => entry.root !== root));
    return list.find((entry) => entry.root === root) ?? null;
  }

  async restore(entry: RecentEntry): Promise<void> {
    await this.#write(withRestored(await this.read(), entry));
  }

  async #write(list: RecentEntry[]): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await Bun.write(this.path, JSON.stringify(list, null, 2));
  }
}
// ~/~ end
// ~/~ begin <<docs/architecture/backend/repos.md#backend-repos>>[4]

export interface RepoSummary {
  root: string;
  /** The first line of the working copy's description, empty if it has none. */
  workingCopy: string;
  reviews: number;
  openedAt: string | null;
}

export async function summarize(
  root: string,
  openedAt: string | null,
  dataDir: string,
): Promise<RepoSummary | null> {
  const log =
    await $`jj --ignore-working-copy log --no-graph -r @ -T ${"description.first_line()"}`
      .cwd(root)
      .quiet()
      .nothrow();
  if (log.exitCode !== 0) return null;
  return {
    root,
    workingCopy: log.stdout.toString().trim(),
    reviews: await countReviews(root, dataDir),
    openedAt,
  };
}

async function countReviews(root: string, dataDir: string): Promise<number> {
  const path = await reviewStorePath(root, dataDir).catch(() => null);
  if (path === null || !(await Bun.file(path).exists())) return 0;
  const store = openReviewStore(path);
  try {
    return store
      .read()
      .document.localReviews.filter(
        (review) => review.forgottenAt === undefined,
      ).length;
  } finally {
    store.close();
  }
}
// ~/~ end
// ~/~ begin <<docs/architecture/backend/repos.md#backend-repos>>[5]

export interface FoundRepo {
  root: string;
  kind: "jj" | "git";
}

const SKIPPED = new Set(["node_modules", "vendor", "target", "dist", "build"]);

export async function findRepos(home: string, depth = 3): Promise<FoundRepo[]> {
  const found: FoundRepo[] = [];
  const walk = async (dir: string, left: number): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    const names = new Set(entries.map((entry) => entry.name));
    const kind = names.has(".jj") ? "jj" : names.has(".git") ? "git" : null;
    if (dir !== home && kind !== null) {
      found.push({ root: dir, kind });
      return;
    }
    if (left === 0) return;
    await Promise.all(
      entries
        .filter(
          (entry) =>
            entry.isDirectory() &&
            !entry.name.startsWith(".") &&
            !SKIPPED.has(entry.name),
        )
        .map((entry) => walk(join(dir, entry.name), left - 1)),
    );
  };
  await walk(home, depth);
  return found.sort((a, b) => a.root.localeCompare(b.root));
}

const FIND_FOR_MS = 5 * 60 * 1000;

/** `findRepos` under the host's home, answered from the last walk for
 *  five minutes. */
function cachedFind(host: Host): () => Promise<FoundRepo[]> {
  let last: { at: number; repos: Promise<FoundRepo[]> } | null = null;
  return () => {
    const now = host.now().getTime();
    if (last === null || now - last.at > FIND_FOR_MS) {
      last = { at: now, repos: findRepos(host.home) };
    }
    return last.repos;
  };
}
// ~/~ end
// ~/~ begin <<docs/architecture/backend/repos.md#backend-repos>>[6]

/** The context of each workspace an agent calls from, opened on its first
 *  call and kept for the run. Workspaces of one repository share a store. */
export class AgentWorkspaces {
  #contexts = new Map<string, Promise<RepoContext>>();
  #stores = new Map<string, ReviewStore>();

  constructor(private readonly host: Host) {}

  context(workspace: string): Promise<RepoContext> {
    let found = this.#contexts.get(workspace);
    if (found === undefined) {
      found = this.#open(workspace);
      this.#contexts.set(workspace, found);
      // A path that is not a workspace yet may become one.
      found.catch(() => this.#contexts.delete(workspace));
    }
    return found;
  }

  async #open(workspace: string): Promise<RepoContext> {
    const probe = await probeRepo(workspace, this.host.home);
    if (probe.kind !== "jj") {
      throw new Error(`no jj workspace at ${workspace}`);
    }
    const path = await reviewStorePath(probe.root, this.host.dataDir);
    let store = this.#stores.get(path);
    if (store === undefined) {
      store = openReviewStore(path);
      this.#stores.set(path, store);
    }
    return { root: probe.root, store };
  }
}

/** Whether two workspaces belong to one repository. */
export async function sameRepo(a: string, b: string): Promise<boolean> {
  const [here, there] = await Promise.all(
    [a, b].map((root) => jjRepoDir(root).catch(() => null)),
  );
  return here !== null && here === there;
}
// ~/~ end
// ~/~ begin <<docs/architecture/backend/repos.md#backend-repos>>[7]

const OpenBody = z.object({ path: z.string().min(1) });
const ForgetBody = z.object({ root: z.string().min(1) });

function refuse(reason: string): Response {
  return Response.json({ error: reason }, { status: 400 });
}

async function recentSummaries(
  recent: RecentRepos,
  dataDir: string,
): Promise<RepoSummary[]> {
  const summaries = await Promise.all(
    (await recent.read()).map((entry) =>
      summarize(entry.root, entry.openedAt, dataDir),
    ),
  );
  return summaries.filter(
    (summary): summary is RepoSummary => summary !== null,
  );
}

export function repoRoutes(
  host: Host,
  served: ServedRepo,
  recent: RecentRepos,
) {
  const foundUnderHome = cachedFind(host);
  return {
    "/api/repo": {
      GET: () =>
        Response.json({
          // How the per-user server's probe tells diffy from another program.
          diffy: 1,
          home: host.home,
          current: served.root,
          startedOutside: served.startedOutside,
        }),
      POST: async (req: Request) => {
        const body = OpenBody.safeParse(await req.json().catch(() => null));
        if (!body.success) return refuse("expected { path }");
        const found = await probeRepo(body.data.path, host.home);
        if (found.kind !== "jj") {
          return refuse(`no jj repository at ${body.data.path}`);
        }
        await served.open(found.root);
        return Response.json({ root: found.root });
      },
    },
    "/api/repo/notice": {
      DELETE: () => {
        served.startedOutside = null;
        return Response.json({});
      },
    },
    "/api/repo/probe": async (req: Request) => {
      const path = new URL(req.url).searchParams.get("path") ?? "";
      return Response.json(
        path === "" ? { kind: "none" } : await probeRepo(path, host.home),
      );
    },
    "/api/repo/recent": {
      GET: async () =>
        Response.json(await recentSummaries(recent, host.dataDir)),
      DELETE: async (req: Request) => {
        const body = ForgetBody.safeParse(await req.json().catch(() => null));
        if (!body.success) return refuse("expected { root }");
        return Response.json({ removed: await recent.forget(body.data.root) });
      },
      PUT: async (req: Request) => {
        const body = RecentEntry.safeParse(await req.json().catch(() => null));
        if (!body.success) return refuse("expected { root, openedAt }");
        await recent.restore(body.data);
        return Response.json({ restored: body.data });
      },
    },
    "/api/repo/found": async () => {
      const known = new Set((await recent.read()).map((entry) => entry.root));
      return Response.json(
        (await foundUnderHome()).filter((repo) => !known.has(repo.root)),
      );
    },
  };
}
// ~/~ end
