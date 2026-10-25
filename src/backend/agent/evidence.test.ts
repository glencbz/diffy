// ~/~ begin <<docs/architecture/backend/evidence.md#backend-agent-evidence-test>>[init]
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { capturesOf } from "../../frontend/model/evidence";
import { EvidenceStore } from "../evidence/store";
import { openReviewStore, type ReviewStore } from "../review/store";
import { evidenceTools } from "./evidence";
import { mcpRoute } from "./mcp";
import { INSTRUCTIONS } from "./review";
import type { SeriesSources } from "./series";

let dir: string;
let store: ReviewStore;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "diffy-evidence-tools-"));
  store = openReviewStore(join(dir, "r.sqlite"));
  await Bun.write(join(dir, "after.png"), "after");
  store.apply({
    kind: "write-components",
    map: {
      series: "pull:o/r#7",
      version: "h".repeat(40),
      author: "claude",
      writtenAt: "t",
      components: [
        {
          commitId: "aaaa1111",
          id: "header",
          kind: "styles",
          name: "header",
          role: "implements",
          gist: "",
          words: [],
          mentions: [],
          places: [{ path: "a.css", side: "after", start: 1, about: "" }],
        },
      ],
      groups: [],
    },
  });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

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
        subject: "dark header",
        description: "dark header",
      },
    ],
  }),
  diff: async () => [],
  files: async () => [],
};

async function call(
  name: string,
  args: Record<string, unknown>,
): Promise<{ text: string; isError: boolean }> {
  const route = mcpRoute(
    evidenceTools(EvidenceStore.in(join(dir, "data")), () => PULL),
    INSTRUCTIONS,
    async () => ({
      repo: { root: "/repo", store, topic: "t" },
      link: (path) => `https://vm:4000${path}`,
      wait: (name) => `diffy wait ${name}`,
      now: () => new Date("2026-10-23T00:00:00Z"),
    }),
  );
  const res = await route.POST(
    new Request("http://localhost/mcp", {
      method: "POST",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
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

const CAPTURE = {
  pull: 7,
  commit: "aaaa",
  id: "settings",
  name: "Settings",
  state: ["dark"],
  size: { width: 800, height: 600 },
};

describe("the evidence tools", () => {
  test("attach a capture, its boxes as fractions of the page", async () => {
    // arrange
    const shows = [
      {
        component: "header",
        box: { x: 0, y: 0, width: 800, height: 60 },
      },
    ];

    // act
    const answer = await call("attach_capture", {
      ...CAPTURE,
      after: join(dir, "after.png"),
      shows,
    });

    // assert
    expect(answer.isError).toBe(false);
    const [capture] = capturesOf(
      store.read().document.captures,
      "pull:o/r#7",
      "h".repeat(40),
    );
    expect(capture?.before).toBeNull();
    expect(capture?.media).toBe("image");
    expect(capture?.shows[0]?.box).toEqual([0, 0, 1, 0.1]);
  });

  test("refuse a component the commit's map lacks", async () => {
    // arrange
    const shows = [{ component: "footer" }];

    // act
    const answer = await call("attach_capture", {
      ...CAPTURE,
      after: join(dir, "after.png"),
      shows,
    });

    // assert
    expect(answer.isError).toBe(true);
    expect(answer.text).toContain("its components are header");
  });

  test("refuse a box measured on another page", async () => {
    // arrange
    const shows = [
      { component: "header", box: { x: 0, y: 0, width: 1600, height: 60 } },
    ];

    // act
    const answer = await call("attach_capture", {
      ...CAPTURE,
      after: join(dir, "after.png"),
      shows,
    });

    // assert
    expect(answer.isError).toBe(true);
    expect(answer.text).toContain("reaches off a 800×600 page");
  });

  test("attaching the same id again replaces it, and detaching takes it off", async () => {
    // arrange
    await call("attach_capture", { ...CAPTURE, after: join(dir, "after.png") });
    await call("attach_capture", {
      ...CAPTURE,
      name: "Settings again",
      after: join(dir, "after.png"),
    });
    const kept = () =>
      capturesOf(store.read().document.captures, "pull:o/r#7", "h".repeat(40));
    const replaced = kept().map((each) => each.name);

    // act
    const answer = await call("detach_capture", {
      pull: 7,
      commit: "aaaa",
      id: "settings",
    });

    // assert
    expect(replaced).toEqual(["Settings again"]);
    expect(answer.isError).toBe(false);
    expect(kept()).toEqual([]);
  });
});
// ~/~ end
