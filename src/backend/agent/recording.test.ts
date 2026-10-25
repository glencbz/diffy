// ~/~ begin <<docs/architecture/backend/recording.md#backend-agent-recording-test>>[init]
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { capturesOf } from "../../frontend/model/evidence";
import type { Recipe, Taken } from "../evidence/recipe";
import type { Recorder } from "../evidence/recorder";
import { EvidenceStore } from "../evidence/store";
import { openReviewStore, type ReviewStore } from "../review/store";
import { mcpRoute } from "./mcp";
import { recordingTools } from "./recording";
import { INSTRUCTIONS } from "./review";
import type { SeriesSources } from "./series";

let dir: string;
let store: ReviewStore;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "diffy-recording-tools-"));
  store = openReviewStore(join(dir, "r.sqlite"));
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
          id: "switch",
          kind: "view",
          name: "switch",
          role: "implements",
          gist: "",
          words: [],
          mentions: [],
          places: [{ path: "a.html", side: "after", start: 1, about: "" }],
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
        subject: "dark switch",
        description: "dark switch",
      },
    ],
  }),
  diff: async () => [],
};

/** A recorder whose parent's side has no switch to click. */
const FAKE: Recorder = {
  async take(base: string, recipe: Recipe): Promise<Taken> {
    if (base.includes("parent")) throw new Error("no element matches #dark");
    const at = await mkdtemp(join(tmpdir(), "diffy-fake-recording-"));
    const file = join(at, recipe.clip ? "clip.webm" : "shot.png");
    await Bun.write(file, `${base}${recipe.path}`);
    return {
      file,
      size: { width: 1000, height: 500 },
      boxes: { "#dark": { x: 100, y: 50, width: 200, height: 100 } },
      done: [1.5],
      length: 3,
    };
  },
  close: async () => {},
};

async function record(args: Record<string, unknown>) {
  const route = mcpRoute(
    recordingTools(EvidenceStore.in(join(dir, "data")), FAKE, () => PULL),
    INSTRUCTIONS,
    async () => ({
      repo: { root: "/repo", store },
      link: (path) => `https://vm:4000${path}`,
      wait: (name) => `diffy wait ${name}`,
      now: () => new Date("2026-10-25T00:00:00Z"),
    }),
  );
  const res = await route.POST(
    new Request("http://localhost/mcp", {
      method: "POST",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "record_captures", arguments: args },
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

const captures = () =>
  capturesOf(store.read().document.captures, "pull:o/r#7", "h".repeat(40));

describe("recording", () => {
  test("a clip shows a component from the end of its step", async () => {
    // act
    const answer = await record({
      pull: 7,
      commit: "aaaa",
      after: "http://localhost:5001",
      before: "http://parent:5002",
      captures: [
        {
          id: "switching",
          name: "Turning it on",
          clip: true,
          steps: [{ do: "click", selector: "#dark" }],
          shows: [{ component: "switch", selector: "#dark", from: 1 }],
        },
      ],
    });

    // assert
    expect(answer.isError).toBe(false);
    expect(answer.text).toContain("nothing at the parent");
    const [capture] = captures();
    expect(capture?.media).toBe("video");
    expect(capture?.before).toBeNull();
    expect(capture?.shows[0]).toMatchObject({
      box: [0.1, 0.1, 0.2, 0.2],
      at: [1.5, 3],
    });
  });

  test("refuses a selector the commit's page lacks", async () => {
    // act
    const answer = await record({
      pull: 7,
      commit: "aaaa",
      after: "http://localhost:5001",
      captures: [
        {
          id: "settings",
          name: "Settings",
          shows: [{ component: "switch", selector: "#missing" }],
        },
      ],
    });

    // assert
    expect(answer.isError).toBe(true);
    expect(answer.text).toContain("#missing");
    expect(captures()).toEqual([]);
  });
});
// ~/~ end
