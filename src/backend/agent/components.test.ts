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
    componentTools(() => PULL),
    INSTRUCTIONS,
    async () => ({
      repo: { root: "/repo", store },
      link: (path) => `https://vm:4000${path}`,
      now: () => new Date(),
    }),
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
  kind: "helper",
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

  test("refuse a move between two places on the same side", async () => {
    // arrange
    const sideways = {
      ...LOUDER,
      places: [
        { path: "a.ts", start: 2, moves: 1 },
        { path: "a.ts", start: 21, moves: 0 },
      ],
    };

    // act
    const written = await call("write_components", {
      pull: 7,
      components: [sideways],
    });

    // assert
    expect(written.isError).toBe(true);
    expect(written.text).toContain("on the same side");
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

  test("write groups and read them back", async () => {
    // arrange
    const group = {
      commit: "aaaa",
      id: "names",
      name: "Louder names",
      gist: "Every name says it louder.",
      components: ["louder"],
    };

    // act
    await call("write_components", {
      pull: 7,
      components: [LOUDER],
      groups: [group],
    });
    const read = await call("read_components", { pull: 7 });

    // assert
    const { commit: _, ...stored } = group;
    expect(store.read().document.componentMaps[0]?.groups).toEqual([
      { ...stored, commitId: "aaaa1111" },
    ]);
    expect(JSON.parse(read.text).groups).toEqual([
      { ...group, commit: "aaaa1111" },
    ]);
  });

  test("refuse a group of a component the commit does not have", async () => {
    // arrange
    // act
    const written = await call("write_components", {
      pull: 7,
      components: [LOUDER],
      groups: [{ commit: "aaaa", id: "g", name: "G", components: ["quiet"] }],
    });

    // assert
    expect(written.isError).toBe(true);
    expect(written.text).toContain("not a component of aaaa1111");
    expect(store.read().document.componentMaps).toEqual([]);
  });

  test("refuse a component in two groups", async () => {
    // arrange
    const twice = (id: string) => ({
      commit: "aaaa",
      id,
      name: id,
      components: ["louder"],
    });

    // act
    const written = await call("write_components", {
      pull: 7,
      components: [LOUDER],
      groups: [twice("a"), twice("b")],
    });

    // assert
    expect(written.isError).toBe(true);
    expect(written.text).toContain("louder is in two groups");
  });
});

describe("the vocabulary tools", () => {
  test("refuse a kind the repository does not use, and say which it does", async () => {
    // arrange
    const model = { ...LOUDER, kind: "model" };

    // act
    const written = await call("write_components", {
      pull: 7,
      components: [model],
    });

    // assert
    expect(written.isError).toBe(true);
    expect(written.text).toContain(
      "louder is a model, which is not a kind this repository uses",
    );
    expect(written.text).toContain("\nview (green): Code that draws");
    expect(store.read().document.componentMaps).toEqual([]);
  });

  test("define a kind a map can then use", async () => {
    // arrange
    // act
    const defined = await call("define_component_kind", {
      name: "model",
      advice: "A class that holds the app's data and rules.",
      colour: "blue",
    });
    const written = await call("write_components", {
      pull: 7,
      components: [{ ...LOUDER, kind: "model" }],
    });

    // assert
    expect(defined.text.split("\n").at(-1)).toBe(
      "model (blue): A class that holds the app's data and rules.",
    );
    expect(written.isError).toBe(false);
  });

  test("replace a kind's advice or colour where it stands, keeping the other", async () => {
    // arrange
    // act
    const advised = await call("define_component_kind", {
      name: "schema",
      advice: "A table.",
    });
    const coloured = await call("define_component_kind", {
      name: "schema",
      colour: "red",
    });

    // assert
    expect(advised.text.split("\n")[0]).toBe("schema (ink): A table.");
    expect(coloured.text.split("\n")[0]).toBe("schema (red): A table.");
    expect(store.read().document.componentKinds).toHaveLength(8);
  });

  test("refuse a new kind with no colour, and say which colours are taken", async () => {
    // arrange
    // act
    const defined = await call("define_component_kind", {
      name: "model",
      advice: "Holds data.",
    });

    // assert
    expect(defined.isError).toBe(true);
    expect(defined.text).toContain("model is a new kind");
    expect(defined.text).toContain("\nwiring (grey)");
  });

  test("place a kind before another", async () => {
    // arrange
    // act
    const placed = await call("define_component_kind", {
      name: "controller",
      advice: "Answers a request.",
      colour: "teal",
      before: "schema",
    });
    const stray = await call("define_component_kind", {
      name: "model",
      advice: "Holds data.",
      colour: "blue",
      before: "nothing",
    });

    // assert
    expect(placed.text.split("\n")[0]).toBe(
      "controller (teal): Answers a request.",
    );
    expect(stray.isError).toBe(true);
  });

  test("refuse a kind that is not a slug", async () => {
    // arrange
    // act
    const defined = await call("define_component_kind", {
      name: "Big Model",
      advice: "A class.",
      colour: "blue",
    });

    // assert
    expect(defined.isError).toBe(true);
  });

  test("remove a kind, and refuse one the repository does not have", async () => {
    // arrange
    // act
    const removed = await call("remove_component_kind", { name: "styles" });
    const again = await call("remove_component_kind", { name: "styles" });

    // assert
    expect(removed.text).not.toContain("styles");
    expect(again.isError).toBe(true);
    expect(again.text).toContain("styles is not a kind this repository uses");
  });

  test("let a repository with no vocabulary use any kind", async () => {
    // arrange
    for (const { name } of store.read().document.componentKinds) {
      await call("remove_component_kind", { name });
    }

    // act
    const read = await call("read_component_kinds", {});
    const written = await call("write_components", {
      pull: 7,
      components: [{ ...LOUDER, kind: "anything" }],
    });

    // assert
    expect(read.text).toContain("no vocabulary");
    expect(written.isError).toBe(false);
  });
});
// ~/~ end
