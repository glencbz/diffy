// ~/~ begin <<docs/architecture/frontend/commit-history.md#frontend-state-commits-test>>[init]
import { afterEach, describe, expect, test } from "bun:test";
import { GitOid } from "../api";
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
    const commits = await commitsFrom({ kind: "jj", operation: null });

    // assert
    expect(commits).toEqual(entries);
    expect(asked).toEqual(["/api/log"]);
  });

  test("reads a jj source at the operation it names", async () => {
    // arrange
    const asked = serve([]);

    // act
    await commitsFrom({ kind: "jj", operation: "0a1b2c" });

    // assert
    expect(asked).toEqual(["/api/log?op=0a1b2c"]);
  });

  test("reads a pull source out of that head's commits", async () => {
    // arrange
    const asked = serve({
      head: HEAD,
      version: 7,
      base: BASE,
      commits: [
        {
          commitId: HEAD,
          parents: [BASE],
          description: "frontend: give the graph side-by-side branch lanes",
          author: "glencbz",
          authoredAt: "2026-09-10T09:00:00Z",
        },
      ],
    });

    // act
    const commits = await commitsFrom({
      kind: "pull",
      repo: "glencbz/diffy",
      number: 9,
      head: HEAD,
    });

    // assert
    expect(commits).toEqual([
      {
        commitId: HEAD,
        changeId: null,
        description: "frontend: give the graph side-by-side branch lanes",
        parents: [BASE],
        author: "glencbz",
        timestamp: "2026-09-10T09:00:00Z",
        refs: [],
        markers: [],
      },
    ]);
    expect(asked[0]).toBe(
      `/api/github/pull/commits?repo=glencbz%2Fdiffy&number=9&head=${HEAD}`,
    );
  });
});
// ~/~ end
