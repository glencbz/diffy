// ~/~ begin <<docs/architecture/backend/repos.md#backend-repos-test>>[init]
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
// ~/~ end
