// ~/~ begin <<docs/architecture/backend/github.md#github-module-test>>[init]
import { describe, expect, test } from "bun:test";
import * as z from "zod";
import { GitOid } from "./git";
import {
  type ForcePushEvent,
  GitHubError,
  type GitHubGraphQL,
  githubPullRequestHistory,
  githubPullRequests,
  headChain,
  PullNumber,
  type PullRequestHistory,
  parsePullNumber,
  parseRepoRef,
  pullStateAt,
} from "./github";

/** The heads pull request #9 of this repo has had, oldest first. */
const CHAIN = [
  "bb968350e9b427d7081a4cd8d7699a4936af8aaa",
  "84368e28591b12827c1ef6d9ebce1c225ac51868",
  "232e5944d8ecaee9c9c730b58fc0c1a51b4bf962",
  "48aed1fce0d2ea0640a379e0a05509a688ed3c89",
  "15defada34973f61ac514fda1dfe326daeb530f2",
  "96c03b8a3c3066ea66b34fd59876275d8710046e",
  "6f24fa3fd3438f5ebe25018b5d6ba471bf119b45",
].map((oid) => GitOid.parse(oid));

const BASE = GitOid.parse("e28c33e61b920728d79d099a9963ff23a865ef98");

function oid(seed: string): GitOid {
  return GitOid.parse(seed.repeat(40).slice(0, 40));
}

/** Consecutive heads, as the timeline would report the pushes between them. */
function chainEvents(heads: GitOid[]): ForcePushEvent[] {
  return heads.slice(1).map((after, index) => ({
    at: `2026-09-0${index + 1}T10:00:00Z`,
    before: heads[index] as GitOid,
    after,
  }));
}

describe("headChain", () => {
  test("a PR with no force pushes has one state, where it opened", () => {
    // arrange
    // act
    const states = headChain([], oid("a"));

    // assert
    expect(states).toEqual([
      { version: 1, head: oid("a"), origin: { kind: "opened" } },
    ]);
  });

  test("one force push yields the opening head and the new one", () => {
    // arrange
    const events = chainEvents([oid("a"), oid("b")]);

    // act
    const states = headChain(events, oid("b"));

    // assert
    expect(states).toEqual([
      { version: 1, head: oid("a"), origin: { kind: "opened" } },
      {
        version: 2,
        head: oid("b"),
        origin: { kind: "force-pushed", at: events[0]?.at ?? "" },
      },
    ]);
  });

  test("a linked chain of pushes keeps every head in order", () => {
    // arrange
    const heads = [oid("a"), oid("b"), oid("c"), oid("d")];

    // act
    const states = headChain(chainEvents(heads), oid("d"));

    // assert
    expect(states.map((state) => state.head)).toEqual(heads);
    expect(states.map((state) => state.version)).toEqual([1, 2, 3, 4]);
    expect(states[0]?.origin).toEqual({ kind: "opened" });
    for (const state of states.slice(1)) {
      expect(state.origin.kind).toBe("force-pushed");
    }
  });

  test("appends the tip when no event names it, as a fast-forward push", () => {
    // arrange
    const events = chainEvents([oid("a"), oid("b")]);

    // act
    const states = headChain(events, oid("c"));

    // assert
    expect(states.map((state) => state.head)).toEqual([
      oid("a"),
      oid("b"),
      oid("c"),
    ]);
    expect(states.at(-1)?.origin).toEqual({ kind: "current" });
  });

  test("collapses a push that left the head where it was", () => {
    // arrange
    const events = chainEvents([oid("a"), oid("a"), oid("b")]);

    // act
    const states = headChain(events, oid("b"));

    // assert
    expect(states.map((state) => state.head)).toEqual([oid("a"), oid("b")]);
  });

  test("numbers states after collapsing, so versions have no gaps", () => {
    // arrange
    const events = chainEvents([oid("a"), oid("a"), oid("b"), oid("b")]);

    // act
    const states = headChain(events, oid("b"));

    // assert
    expect(states.map((state) => state.version)).toEqual([1, 2]);
  });
});
// ~/~ end
// ~/~ begin <<docs/architecture/backend/github.md#github-module-test>>[1]

const REPO = { owner: "glencbz", name: "diffy" };

/** A transport that answers every query with one captured envelope. */
function stub(envelope: unknown): GitHubGraphQL {
  return () => Promise.resolve(envelope);
}

function historyEnvelope(
  nodes: unknown[],
  hasNextPage = false,
  head: GitOid = CHAIN.at(-1) as GitOid,
): unknown {
  return {
    data: {
      repository: {
        pullRequest: {
          number: 9,
          headRefOid: head,
          baseRefName: "main",
          baseRefOid: BASE,
          timelineItems: { pageInfo: { hasNextPage }, nodes },
        },
      },
    },
  };
}

/** The six force pushes of pull request #9, as GraphQL returns them. */
const PULL_9_NODES = CHAIN.slice(1).map((after, index) => ({
  createdAt: `2026-09-0${index + 1}T10:00:00Z`,
  beforeCommit: { oid: CHAIN[index] },
  afterCommit: { oid: after },
}));

describe("githubPullRequestHistory", () => {
  test("turns a real timeline into the chain of heads", async () => {
    // arrange
    const gh = stub(historyEnvelope(PULL_9_NODES));

    // act
    const history = await githubPullRequestHistory(
      REPO,
      PullNumber.parse(9),
      gh,
    );

    // assert
    expect(history.states).toHaveLength(7);
    expect(history.states.map((state) => state.head)).toEqual(CHAIN);
    expect(history.states[0]?.origin).toEqual({ kind: "opened" });
    expect(history.states.at(-1)?.head).toBe(CHAIN.at(-1) as GitOid);
    expect(history.baseRefOid).toBe(BASE);
    expect(history.baseRefName).toBe("main");
    expect(history.truncated).toBe(false);
  });

  test("reports a full page of force pushes as truncated", async () => {
    // arrange
    const gh = stub(historyEnvelope(PULL_9_NODES, true));

    // act
    const history = await githubPullRequestHistory(
      REPO,
      PullNumber.parse(9),
      gh,
    );

    // assert
    expect(history.truncated).toBe(true);
  });

  test("drops an event GitHub has collected, and says so", async () => {
    // arrange
    const nodes = [
      ...PULL_9_NODES,
      {
        createdAt: "2026-09-09T10:00:00Z",
        beforeCommit: null,
        afterCommit: { oid: CHAIN.at(-1) },
      },
    ];
    const gh = stub(historyEnvelope(nodes));

    // act
    const history = await githubPullRequestHistory(
      REPO,
      PullNumber.parse(9),
      gh,
    );

    // assert
    expect(history.states.map((state) => state.head)).toEqual(CHAIN);
    expect(history.truncated).toBe(true);
  });

  test("reports a null pullRequest as not-found", async () => {
    // arrange
    const gh = stub({ data: { repository: { pullRequest: null } } });

    // act
    const attempt = githubPullRequestHistory(REPO, PullNumber.parse(99999), gh);

    // assert
    await expect(attempt).rejects.toMatchObject({
      name: "GitHubError",
      kind: "not-found",
    });
  });
});

describe("githubPullRequests", () => {
  const NODES = [
    {
      number: 13,
      title: "jj: interdiff two commits, and two commit series",
      state: "MERGED",
      author: { login: "glencbz" },
      updatedAt: "2026-09-12T09:00:00Z",
      headRefOid: CHAIN[2],
      baseRefName: "main",
      url: "https://github.com/glencbz/diffy/pull/13",
    },
    {
      number: 9,
      title: "frontend: give the graph side-by-side branch lanes",
      state: "OPEN",
      author: null,
      updatedAt: "2026-09-10T09:00:00Z",
      headRefOid: CHAIN.at(-1),
      baseRefName: "main",
      url: "https://github.com/glencbz/diffy/pull/9",
    },
  ];

  test("reads the list in the order GitHub returned it", async () => {
    // arrange
    const gh = stub({
      data: { repository: { pullRequests: { nodes: NODES } } },
    });

    // act
    const pulls = await githubPullRequests(REPO, { state: "all" }, gh);

    // assert
    expect(pulls.map((pull) => pull.number) as number[]).toEqual([13, 9]);
    expect(pulls[0]?.state).toBe("MERGED");
    expect(pulls[0]?.headRefOid).toBe(CHAIN[2] as GitOid);
  });

  test("reads a deleted author as an empty login", async () => {
    // arrange
    const gh = stub({
      data: { repository: { pullRequests: { nodes: NODES } } },
    });

    // act
    const pulls = await githubPullRequests(REPO, {}, gh);

    // assert
    expect(pulls[1]?.author).toBe("");
  });

  test("reports a null repository as not-found", async () => {
    // arrange
    const gh = stub({ data: { repository: null } });

    // act
    const attempt = githubPullRequests(REPO, {}, gh);

    // assert
    await expect(attempt).rejects.toMatchObject({ kind: "not-found" });
  });
});

describe("parseRepoRef", () => {
  test("splits an owner/name slug", () => {
    // arrange
    // act
    // assert
    expect(parseRepoRef("glencbz/diffy")).toEqual({
      owner: "glencbz",
      name: "diffy",
    });
  });

  test.each(["", "diffy", "glencbz/", "/diffy", "a/b/c", "glen cbz/diffy"])(
    "refuses %p",
    (raw) => {
      // arrange
      // act
      // assert
      expect(() => parseRepoRef(raw)).toThrow(z.ZodError);
    },
  );
});

describe("parsePullNumber", () => {
  test("reads a positive integer", () => {
    // arrange
    // act
    // assert
    expect(parsePullNumber("9")).toBe(PullNumber.parse(9));
  });

  test.each([null, "", "0", "-1", "1.5", "nine", "9; drop"])(
    "refuses %p",
    (raw) => {
      // arrange
      // act
      // assert
      expect(() => parsePullNumber(raw)).toThrow(z.ZodError);
    },
  );
});
// ~/~ end
// ~/~ begin <<docs/architecture/backend/github.md#github-module-test>>[2]

/** The error a call threw, so an assertion can look past its message. */
function catchError(call: () => unknown): unknown {
  try {
    call();
  } catch (error) {
    return error;
  }
  throw new Error("expected the call to throw");
}

describe("pullStateAt", () => {
  const history: PullRequestHistory = {
    number: PullNumber.parse(9),
    baseRefName: "main",
    baseRefOid: BASE,
    states: headChain(chainEvents(CHAIN), CHAIN.at(-1) as GitOid),
    truncated: false,
  };

  test("finds the head the pull request opened with", () => {
    // arrange
    // act
    const state = pullStateAt(history, CHAIN[0] as GitOid);

    // assert
    expect(state).toEqual({
      version: 1,
      head: CHAIN[0] as GitOid,
      origin: { kind: "opened" },
    });
  });

  test("finds a head a force push produced", () => {
    // arrange
    // act
    const state = pullStateAt(history, CHAIN[4] as GitOid);

    // assert
    expect(state.version).toBe(5);
    expect(state.head).toBe(CHAIN[4] as GitOid);
    expect(state.origin.kind).toBe("force-pushed");
  });

  test("refuses a head the pull request never had", () => {
    // arrange
    const stranger = oid("f");

    // act
    const error = catchError(() => pullStateAt(history, stranger));

    // assert
    expect(error).toBeInstanceOf(GitHubError);
    expect(error).toMatchObject({ kind: "not-found" });
    expect((error as Error).message).toContain(stranger);
  });
});
// ~/~ end
