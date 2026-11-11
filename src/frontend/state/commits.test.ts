// ~/~ begin <<docs/architecture/frontend/commit-history.md#frontend-state-commits-test>>[init]
import { afterEach, describe, expect, test } from "bun:test";
import { GitOid } from "../model/history";
import { commitsFrom } from "./commits";

const liveFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = liveFetch;
});

/** Answer every request with one canned body, recording what was asked for. */
function serve(body: unknown): string[] {
  const asked: string[] = [];
  globalThis.fetch = ((input: RequestInfo | URL) => {
    asked.push(String(input));
    return Promise.resolve(Response.json(body));
  }) as typeof fetch;
  return asked;
}

const HEAD = GitOid.parse("6f24fa3fd3438f5ebe25018b5d6ba471bf119b45");
const BASE = GitOid.parse("e28c33e61b920728d79d099a9963ff23a865ef98");

describe("commitsFrom", () => {
  test("reads a jj source out of the live commit log", async () => {
    // arrange
    const entries = [
      {
        commitId: "c1",
        changeId: "k1",
        description: "one",
        parents: [],
        author: "someone@example.com",
        timestamp: "2026-01-01T00:00:00Z",
        refs: [],
        markers: [],
      },
    ];
    const asked = serve(entries);

    // act
    const commits = await commitsFrom("/w", { kind: "jj", operation: null });

    // assert
    expect(commits).toEqual(entries);
    expect(asked).toEqual(["/api/log?workspace=%2Fw"]);
  });

  test("reads a jj source at the operation it names", async () => {
    // arrange
    const asked = serve([]);

    // act
    await commitsFrom("/w", { kind: "jj", operation: "0a1b2c" });

    // assert
    expect(asked).toEqual(["/api/log?op=0a1b2c&workspace=%2Fw"]);
  });

  test("reads a local source out of its commits, newest first", async () => {
    // arrange
    const commit = (id: GitOid, parent: GitOid, changeId: string) => ({
      commitId: id,
      parents: [parent],
      description: "frontend: give the graph side-by-side branch lanes",
      author: "glencbz",
      authoredAt: "2026-09-10T09:00:00Z",
      changeId,
    });
    const asked = serve([commit(BASE, HEAD, "kx"), commit(HEAD, BASE, "ky")]);

    // act
    const commits = await commitsFrom("/w", {
      kind: "local",
      commits: [BASE, HEAD],
    });

    // assert
    expect(commits.map((entry) => [entry.commitId, entry.changeId])).toEqual([
      [HEAD, "ky"],
      [BASE, "kx"],
    ]);
    expect(commits[0]?.timestamp).toBe("2026-09-10T09:00:00Z");
    expect(asked[0]).toBe(
      `/api/local/commits?id=${BASE}&id=${HEAD}&workspace=%2Fw`,
    );
  });
});
// ~/~ end
