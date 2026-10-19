# Choosing the repository

diffy serves one repository at a time, and the reader can switch it from the
browser. This module decides which repository a run starts in, remembers the
ones the reader opened, finds others under the home directory, and swaps the
served one in place. The [command line](cli.md) starts it; the
[server](server.md) mounts its routes.

## Serving one repository at a time

Every route shells out to `jj` or `git` in the working directory, so switching
is `process.chdir` plus reopening that repository's
[review store](review-store.md). Passing a repository root to every jj and git
call would let each browser tab read a different repository, but it would
thread a parameter through every backend module for a reader who works in one
repository at a time. A request in flight while the reader switches can read
the new repository; the browser reloads on a switch, so it never shows that
answer.

`ServedRepo.store` is a `ReviewStore` that forwards to the current
repository's store, so the review routes and the agent tools keep the one
store they were built with across a switch.

```ts
//| id: backend-repos
//| file: src/backend/repo/repos.ts
import { mkdir, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { $ } from "bun";
import * as z from "zod";
import { jjRepoDir } from "../commit/jj";
import {
  openReviewStore,
  purgeForgotten,
  type ReviewStore,
  reviewStorePath,
  watchReview,
} from "../review/store";

/** The repository being served and its review store. */
export class ServedRepo {
  #current: { root: string; store: ReviewStore; stop: () => void } | null =
    null;
  /** Where the run started, while diffy serves a repository from the recent
   *  list in its place. */
  startedOutside: string | null = null;

  constructor(
    private readonly recent: RecentRepos,
    private readonly publish: (revision: number) => void,
  ) {}

  get root(): string | null {
    return this.#current?.root ?? null;
  }

  async open(root: string, startedOutside: string | null = null) {
    process.chdir(root);
    const store = openReviewStore(await reviewStorePath());
    this.#current?.stop();
    const stopWatch = watchReview(store, this.publish);
    const stopPurge = purgeForgotten(store);
    this.#current = {
      root,
      store,
      stop: () => {
        stopWatch();
        stopPurge();
        store.close();
      },
    };
    this.startedOutside = startedOutside;
    await this.recent.opened(root, new Date().toISOString());
  }

  readonly store: ReviewStore = {
    read: () => this.#store().read(),
    apply: (command) => this.#store().apply(command),
    revision: () => this.#store().revision(),
    close: () => this.#current?.stop(),
  };

  #store(): ReviewStore {
    if (this.#current === null) throw new Error("no repository is open");
    return this.#current.store;
  }
}
```

## Probing a path

A path the reader typed or a run was started in is a jj workspace, a Git
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

export function expandHome(path: string, home = homedir()): string {
  if (path === "~") return home;
  if (path.startsWith("~/")) return join(home, path.slice(2));
  return resolve(path);
}

export async function probeRepo(path: string): Promise<Probe> {
  const dir = expandHome(path);
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
ends the run. Without one, diffy serves the workspace it was started in, as it
always has; started anywhere else it serves the repository opened most
recently that still exists, and says so. With none of those it starts with no
repository and the browser asks for one.

```ts
//| id: backend-repos

export type Start =
  | { kind: "open"; root: string; startedOutside: string | null }
  | { kind: "choose"; startedOutside: string }
  | { kind: "fail"; reason: string };

export async function startingRepo(
  given: string | undefined,
  cwd: string,
  recent: RecentEntry[],
  probe: (path: string) => Promise<Probe> = probeRepo,
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
```

## The recent list

The repositories the reader opened live in `recent.json` beside the review
stores, newest first, one entry per workspace root, so two workspaces of one
repository are two entries. Every diffy run reads and writes the same file;
two runs opening a repository at the same moment can lose one entry, which
the next open puts back. A file that does not parse reads as empty rather
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

  static async at(
    env: Record<string, string | undefined> = process.env,
  ): Promise<RecentRepos> {
    const dataHome = env.XDG_DATA_HOME || join(homedir(), ".local", "share");
    return new RecentRepos(join(dataHome, "diffy", "recent.json"));
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
    reviews: await countReviews(root),
    openedAt,
  };
}

async function countReviews(root: string): Promise<number> {
  const path = await reviewStorePath(process.env, root).catch(() => null);
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
let lastFind: { at: number; repos: Promise<FoundRepo[]> } | null = null;

function foundUnderHome(): Promise<FoundRepo[]> {
  if (lastFind === null || Date.now() - lastFind.at > FIND_FOR_MS) {
    lastFind = { at: Date.now(), repos: findRepos(homedir()) };
  }
  return lastFind.repos;
}
```

## An agent in another repository

An agent's tools write to the served repository's store, its reviews and its
vocabulary of component kinds, so an agent working in one repository while
the reader has switched diffy to another would write into the wrong one.
[`diffy mcp`](agents.md#the-stdio-bridge) names the workspace it was started
in, and a tool call from a workspace of another repository is refused with
what to do. Workspaces of one repository share a store, so they are compared
by [the repository behind them](jj.md), not by their roots.

Switching to the agent's repository instead would keep the agent going, but
would change what the reader's open tab shows, reviews and kinds alike,
without the reader asking.

```ts
//| id: backend-repos

/** Why a tool call from an agent in the workspace at `caller` cannot run
 *  here, or null when it can. */
export async function wrongRepo(
  served: ServedRepo,
  caller: string,
): Promise<string | null> {
  const current = served.root;
  const switchTo = `Ask the reader to switch diffy to ${caller} (running \`diffy\` there does it), then call again.`;
  if (current === null) return `diffy has no repository open. ${switchTo}`;
  const [here, there] = await Promise.all(
    [current, caller].map((root) => jjRepoDir(root).catch(() => null)),
  );
  if (here !== null && here === there) return null;
  return `diffy is showing ${current}, not ${caller}, so this call would read and write that repository's reviews. ${switchTo}`;
}
```

## Routes

`/api/repo` answers which repository is served and opens another; every
screen needs it before it draws, so it reads nothing slow. What the picker
lists is a route of its own each, asked for only once the picker opens: the
recent list runs jj once per entry, and the walk can take seconds the first
time. The home directory comes with the served repository so the browser can
write paths with `~`.

Dismissing the notice that diffy fell back to a recent repository clears it
for every browser, since it is about the run rather than one screen.

```ts
//| id: backend-repos

const OpenBody = z.object({ path: z.string().min(1) });
const ForgetBody = z.object({ root: z.string().min(1) });

function refuse(reason: string): Response {
  return Response.json({ error: reason }, { status: 400 });
}

async function recentSummaries(recent: RecentRepos): Promise<RepoSummary[]> {
  const summaries = await Promise.all(
    (await recent.read()).map((entry) => summarize(entry.root, entry.openedAt)),
  );
  return summaries.filter(
    (summary): summary is RepoSummary => summary !== null,
  );
}

export function repoRoutes(served: ServedRepo, recent: RecentRepos) {
  return {
    "/api/repo": {
      GET: () =>
        Response.json({
          // How the per-user server's probe tells diffy from another program.
          diffy: 1,
          home: homedir(),
          current: served.root,
          startedOutside: served.startedOutside,
        }),
      POST: async (req: Request) => {
        const body = OpenBody.safeParse(await req.json().catch(() => null));
        if (!body.success) return refuse("expected { path }");
        const found = await probeRepo(body.data.path);
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
        path === "" ? { kind: "none" } : await probeRepo(path),
      );
    },
    "/api/repo/recent": {
      GET: async () => Response.json(await recentSummaries(recent)),
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
    expect(await startingRepo("~/a", "/tmp", recent, probe)).toEqual({
      kind: "open",
      root: "/home/me/a",
      startedOutside: null,
    });
    expect((await startingRepo("~/g", "/tmp", recent, probe)).kind).toBe(
      "fail",
    );
    expect((await startingRepo("~/n", "/tmp", recent, probe)).kind).toBe(
      "fail",
    );
  });

  test("serves the workspace it started in", async () => {
    const probe = probes({ "/work/a/src": { kind: "jj", root: "/work/a" } });
    expect(await startingRepo(undefined, "/work/a/src", recent, probe)).toEqual(
      { kind: "open", root: "/work/a", startedOutside: null },
    );
  });

  test("started elsewhere, serves the newest recent one that exists", async () => {
    const probe = probes({ "/work/b": { kind: "jj", root: "/work/b" } });
    expect(await startingRepo(undefined, "/tmp", recent, probe)).toEqual({
      kind: "open",
      root: "/work/b",
      startedOutside: "/tmp",
    });
  });

  test("with nothing to serve, asks", async () => {
    expect(await startingRepo(undefined, "/tmp", recent, probes({}))).toEqual({
      kind: "choose",
      startedOutside: "/tmp",
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
