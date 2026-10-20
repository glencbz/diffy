# Choosing the repository

diffy shows the reader one repository at a time, and the reader can switch it
from the browser. This module decides which repository a run starts in,
remembers the ones the reader opened, finds others under the home directory,
and hands each request the repository it runs in. The
[command line](cli.md) starts it; the [server](server.md) mounts its routes.

## A repository per request

Every jj and git call takes the workspace root it runs in, and every route
and agent tool is handed a `RepoContext`: that root, its repository's
[review store](review-store.md), and the topic the store's changes are
announced under. A browser request names its tab's workspace, an agent's
call names the agent's, and `Workspaces` turns either into a context, so two
tabs, a phone and an agent can each be in a repository of their own.
Changing the process's working directory on a switch would spare every
backend function its root, but would put everyone in whatever repository
was switched to last.

`DefaultRepo` is only what a tab that names no repository opens on: the one
the reader opened last. Opening a repository in one tab moves it, and leaves
every tab already open where it was.

```ts
//| id: backend-repos
//| file: src/backend/repo/repos.ts
import { mkdir, readdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { $ } from "bun";
import * as z from "zod";
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
  /** What the store's revisions are published under, the same for every
   *  workspace of one repository. */
  topic: string;
}

/** The repository a tab opens on when its address names none: the one the
 *  reader opened last. */
export class DefaultRepo {
  #root: string | null = null;

  constructor(
    private readonly host: Host,
    /** The list each repository opened here joins, or null for a server
     *  that leaves the reader's list alone. */
    private readonly recent: RecentRepos | null,
  ) {}

  get root(): string | null {
    return this.#root;
  }

  async open(root: string) {
    this.#root = root;
    await this.recent?.opened(root, this.host.now().toISOString());
  }
}
```

## Probing a path

A path the reader typed or named on the command line is a jj workspace, a Git
repository jj has not been set up in, or neither. The Git case is told apart
so the picker can say what to run rather than calling the folder empty.
`--ignore-working-copy` keeps a probe from snapshotting a repository the reader
only looked at.

```ts
//| id: backend-repos

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
```

## Where a run starts

A path on the command line is held to, and one that is not a jj workspace
ends the run. Without one, diffy serves the repository the reader opened
last that still exists, wherever the run was started. With none it starts with
no repository and the browser asks for one.

```ts
//| id: backend-repos

export type Start =
  | { kind: "open"; root: string }
  | { kind: "choose" }
  | { kind: "fail"; reason: string };

export async function startingRepo(
  given: string | undefined,
  recent: RecentEntry[],
  probe: (path: string) => Promise<Probe>,
): Promise<Start> {
  if (given !== undefined) {
    const found = await probe(given);
    switch (found.kind) {
      case "jj":
        return { kind: "open", root: found.root };
      case "git":
        return {
          kind: "fail",
          reason: `${found.root} is a Git repository without jj; run jj git init --colocate there`,
        };
      case "none":
        return { kind: "fail", reason: `no jj repository at ${given}` };
    }
  }
  for (const entry of recent) {
    const found = await probe(entry.root);
    if (found.kind === "jj") return { kind: "open", root: found.root };
  }
  return { kind: "choose" };
}
```

## The recent list

The repositories the reader opened live in `recent.json` beside the review
stores, newest first, one entry per workspace root, so two workspaces of one
repository are two entries. Only [this user's server](cli.md#the-sticky-port)
adds to it, so its newest entry is the repository the reader was last working
in. Two runs opening a repository at the same moment can lose one entry,
which the next open puts back. A file that does not parse reads as empty rather
than stopping the run.

Forgetting an entry answers with what it removed, so the browser can put it
back with its time when the reader undoes it.

```ts
//| id: backend-repos

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
```

## What the picker shows

Each recent repository is shown with its working copy's description and how
many local reviews it holds, read from its own store without serving it. An
entry whose folder is gone or no longer a jj workspace is left out rather than
dropped from the file, so a drive that comes back brings it back.

```ts
//| id: backend-repos

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
```

## Finding repositories nobody opened

The picker also lists repositories under the home directory the reader has not
opened yet. The walk goes three folders deep, skips hidden folders and
dependency trees, and stops at the first repository on each path, so a
workspace's nested checkouts and vendored repositories stay out. A walk takes
a moment on a large home directory, so its answer is kept for five minutes.

```ts
//| id: backend-repos

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
```

## Opening a workspace

`Workspaces` opens a workspace's context the first time a tab or an
[agent](agents.md#the-stdio-bridge) names it, and keeps it for the run.
Workspaces of one repository share a store, so a store is kept by its path,
which [the repository behind them](jj.md) decides, not by the workspace root.
Each store is watched and purged once, however many tabs read it, and its
path is the topic its revisions are announced under, so a tab hears about
its own repository's writes and no other's.

Refusing a call from another repository than the reader's would keep one
store per run, but would stop an agent whenever the reader looked elsewhere,
and switching the reader to the agent's repository would change their open
tab without their asking.

```ts
//| id: backend-repos

/** The context of every workspace a tab or an agent names, opened on its
 *  first use and kept for the run. Workspaces of one repository share a
 *  store, and each store is watched once. */
export class Workspaces {
  #contexts = new Map<string, Promise<RepoContext>>();
  #stores = new Map<string, ReviewStore>();

  constructor(
    private readonly host: Host,
    private readonly publish: (topic: string, revision: number) => void,
  ) {}

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
      watchReview(store, (revision) => this.publish(path, revision));
      purgeForgotten(store, this.host.now);
    }
    return { root: probe.root, store, topic: path };
  }
}
```

## Routes

`/api/repo` answers which repository is served and opens another; every
screen needs it before it draws, so it reads nothing slow. What the picker
lists is a route of its own each, asked for only once the picker opens: the
recent list runs jj once per entry, and the walk can take seconds the first
time. The home directory comes with the served repository so the browser can
write paths with `~`.

```ts
//| id: backend-repos

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
  defaultRepo: DefaultRepo,
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
          current: defaultRepo.root,
        }),
      POST: async (req: Request) => {
        const body = OpenBody.safeParse(await req.json().catch(() => null));
        if (!body.success) return refuse("expected { path }");
        const found = await probeRepo(body.data.path, host.home);
        if (found.kind !== "jj") {
          return refuse(`no jj repository at ${body.data.path}`);
        }
        await defaultRepo.open(found.root);
        return Response.json({ root: found.root });
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
```

## Tests

```ts
//| id: backend-repos-test
//| file: src/backend/repo/repos.test.ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  expandHome,
  findRepos,
  type Probe,
  RecentRepos,
  startingRepo,
  withOpened,
  withRestored,
} from "./repos";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "diffy-repos-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("expandHome", () => {
  test("reads ~ as the home directory", () => {
    expect(expandHome("~", "/home/me")).toBe("/home/me");
    expect(expandHome("~/src/a", "/home/me")).toBe("/home/me/src/a");
    expect(expandHome("/srv/a", "/home/me")).toBe("/srv/a");
  });
});

describe("startingRepo", () => {
  const probes =
    (known: Record<string, Probe>) =>
    async (path: string): Promise<Probe> =>
      known[path] ?? { kind: "none" };
  const recent = [
    { root: "/gone", openedAt: "2026-10-02T00:00:00Z" },
    { root: "/work/b", openedAt: "2026-10-01T00:00:00Z" },
  ];

  test("serves a given path, and fails on one without jj", async () => {
    const probe = probes({
      "~/a": { kind: "jj", root: "/home/me/a" },
      "~/g": { kind: "git", root: "/home/me/g" },
    });
    expect(await startingRepo("~/a", recent, probe)).toEqual({
      kind: "open",
      root: "/home/me/a",
    });
    expect((await startingRepo("~/g", recent, probe)).kind).toBe("fail");
    expect((await startingRepo("~/n", recent, probe)).kind).toBe("fail");
  });

  test("without a path, serves the newest recent one that exists", async () => {
    const probe = probes({ "/work/b": { kind: "jj", root: "/work/b" } });
    expect(await startingRepo(undefined, recent, probe)).toEqual({
      kind: "open",
      root: "/work/b",
    });
  });

  test("with nothing to serve, asks", async () => {
    expect(await startingRepo(undefined, recent, probes({}))).toEqual({
      kind: "choose",
    });
  });
});

describe("the recent list", () => {
  test("puts an opened repository first, once", () => {
    const list = withOpened(
      [
        { root: "/a", openedAt: "1" },
        { root: "/b", openedAt: "0" },
      ],
      "/b",
      "2",
    );
    expect(list.map((entry) => entry.root)).toEqual(["/b", "/a"]);
  });

  test("puts a restored entry back in time order", () => {
    const list = withRestored(
      [
        { root: "/a", openedAt: "3" },
        { root: "/c", openedAt: "1" },
      ],
      { root: "/b", openedAt: "2" },
    );
    expect(list.map((entry) => entry.root)).toEqual(["/a", "/b", "/c"]);
  });

  test("forgets an entry and answers with it, so it can come back", async () => {
    const recent = new RecentRepos(join(dir, "diffy", "recent.json"));
    await recent.opened("/a", "1");
    await recent.opened("/b", "2");
    const removed = await recent.forget("/a");
    expect(await recent.read()).toEqual([{ root: "/b", openedAt: "2" }]);
    if (removed === null) throw new Error("expected /a to be removed");
    await recent.restore(removed);
    expect((await recent.read()).map((entry) => entry.root)).toEqual([
      "/b",
      "/a",
    ]);
  });

  test("reads a file that does not parse as empty", async () => {
    const path = join(dir, "recent.json");
    await Bun.write(path, "{not json");
    expect(await new RecentRepos(path).read()).toEqual([]);
  });
});

describe("findRepos", () => {
  test("finds repositories, stopping at the first on each path", async () => {
    for (const path of [
      "src/a/.jj",
      "src/a/nested/.git",
      "src/g/.git",
      "src/a-lot/deep/down/b/.jj",
      ".hidden/c/.jj",
      "node_modules/d/.git",
    ]) {
      await mkdir(join(dir, path), { recursive: true });
    }
    expect(await findRepos(dir)).toEqual([
      { root: join(dir, "src/a"), kind: "jj" },
      { root: join(dir, "src/g"), kind: "git" },
    ]);
  });
});
```
