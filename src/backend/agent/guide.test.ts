// ~/~ begin <<docs/architecture/backend/agents.md#backend-agent-guide-test>>[init]
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { jjLog } from "../commit/jj";
import { openReviewStore, type ReviewStore } from "../review/store";
import { type GuideSources, guideTools } from "./guide";
import { mcpRoute } from "./mcp";
import { INSTRUCTIONS } from "./review";

let dir: string;
let store: ReviewStore;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "diffy-guide-"));
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

/** A pull request of two commits, the first changing `a.ts` in two places
 *  and the second changing nothing a guide can point at. */
const PULL: GuideSources = {
  local: () => Promise.reject(new Error("not asked")),
  pull: async (number) => ({
    series: `pull:o/r#${number}`,
    version: "h".repeat(40),
    label: "v2",
    path: `/pulls/${number}`,
    commits: [
      { commitId: "aaaa1111", changeId: null, subject: "first" },
      { commitId: "bbbb2222", changeId: null, subject: "second" },
    ],
  }),
  diff: async (commitId) =>
    commitId === "aaaa1111"
      ? [
          {
            status: "modified",
            path: "a.ts",
            binary: false,
            oldBlob: "1111111",
            newBlob: "2222222",
            patch: PATCH,
            structural: { kind: "unavailable", reason: "test" },
          },
        ]
      : [],
};

let nextId = 1;

async function call(
  sources: GuideSources | undefined,
  name: string,
  args: Record<string, unknown>,
): Promise<{ text: string; isError: boolean }> {
  const route = mcpRoute(
    guideTools(store, sources),
    INSTRUCTIONS,
    () => "https://vm:4000",
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

const IDEA = {
  commit: "aaaa",
  title: "Two is louder",
  stops: [{ path: "a.ts", start: 2, end: 2, note: "the rename" }],
};

describe("the guide tools", () => {
  test("write a guide to a pull request and say what no stop covers", async () => {
    // arrange
    // act
    const written = await call(PULL, "write_guide", {
      pull: 7,
      ideas: [IDEA],
    });

    // assert
    expect(written).toEqual({
      text: [
        "https://vm:4000/pulls/7",
        "the guide to v2: 1 ideas over 1 of 2 commits",
        "not on any stop:",
        "  aaaa1111 a.ts: 20-22",
        "  bbbb2222 has no ideas",
      ].join("\n"),
      isError: false,
    });
    expect(store.read().document.guides).toEqual([
      expect.objectContaining({
        series: "pull:o/r#7",
        version: "h".repeat(40),
        author: "claude",
        ideas: [
          {
            commitId: "aaaa1111",
            title: "Two is louder",
            note: "",
            stops: [
              {
                path: "a.ts",
                side: "after",
                start: 2,
                end: 2,
                note: "the rename",
              },
            ],
          },
        ],
      }),
    ]);
  });

  test("read a guide back in the shape it was written in", async () => {
    // arrange
    const second = {
      commit: "bbbb",
      title: "Why",
      stops: [{ note: "the message says it" }],
    };
    await call(PULL, "write_guide", { pull: 7, ideas: [IDEA, second] });

    // act
    const read = await call(PULL, "read_guide", { pull: 7 });

    // assert
    expect(JSON.parse(read.text)).toEqual({
      ideas: [
        expect.objectContaining({ title: "Two is louder", commit: "aaaa1111" }),
        expect.objectContaining({ title: "Why", commit: "bbbb2222" }),
      ],
    });
  });

  test("tell the agent what it got wrong as a failed call", async () => {
    // arrange
    const wrong = async (args: Record<string, unknown>) =>
      (await call(PULL, "write_guide", { pull: 7, ideas: [IDEA], ...args }))
        .text;

    // act
    // assert
    expect(await wrong({ ideas: [{ ...IDEA, commit: "cccc" }] })).toBe(
      "cccc names 0 commits of the v2 you are guiding, not one",
    );
    expect(
      await wrong({
        ideas: [{ ...IDEA, stops: [{ path: "b.ts", note: "?" }] }],
      }),
    ).toBe(
      "aaaa1111 does not change b.ts, which a stop of Two is louder names",
    );
    expect(
      await wrong({
        ideas: [{ ...IDEA, stops: [{ path: "a.ts", end: 2, note: "?" }] }],
      }),
    ).toBe("a stop of Two is louder ends at 2 without starting before it");
    expect(
      (await call(PULL, "write_guide", { review: "x", pull: 7, ideas: [IDEA] }))
        .text,
    ).toBe("name one of review or pull");
    expect(store.read().document.guides).toEqual([]);
  });

  test("write a guide to the newest version of a local review", async () => {
    // arrange
    const [tip] = await jjLog({ revset: "latest(::trunk() ~ empty())" });
    if (tip === undefined) throw new Error("no history");
    store.apply({
      kind: "register",
      name: "t",
      version: {
        operation: "o",
        revset: "t",
        commits: [tip.commitId],
        registeredAt: "t",
      },
    });

    // act
    const written = await call(undefined, "write_guide", {
      review: "t",
      ideas: [
        {
          commit: tip.changeId.slice(0, 8),
          title: "Everything",
          stops: [{ note: "read the message first" }],
        },
      ],
    });
    const read = await call(undefined, "read_guide", { review: "t" });

    // assert
    expect(written.text.split("\n").slice(0, 2)).toEqual([
      "https://vm:4000/reviews/t",
      "the guide to v1: 1 ideas over 1 of 1 commits",
    ]);
    expect(JSON.parse(read.text).ideas[0].commit).toBe(
      tip.changeId.slice(0, 8),
    );
  });
});
// ~/~ end
