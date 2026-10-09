// ~/~ begin <<docs/architecture/backend/agents.md#backend-agent-components-test>>[init]
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
    componentTools(store, PULL),
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

const LOUDER = {
  commit: "aaaa",
  id: "louder",
  kind: "rename",
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
});
// ~/~ end
