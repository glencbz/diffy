// ~/~ begin <<docs/architecture/backend/runs.md#backend-agent-runs-test>>[init]
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runsOf } from "../../frontend/model/runs";
import type { PlayedStep } from "../evidence/playRun";
import type { Recorder } from "../evidence/recorder";
import type { Played } from "../evidence/recordRun";
import { EvidenceStore } from "../evidence/store";
import { openReviewStore, type ReviewStore } from "../review/store";
import { mcpRoute } from "./mcp";
import { INSTRUCTIONS } from "./review";
import { againstFiles, runTools } from "./runs";
import type { SeriesSources } from "./series";

let dir: string;
let store: ReviewStore;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "diffy-run-tools-"));
  store = openReviewStore(join(dir, "r.sqlite"));
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
  files: async () => ["theme.js"],
};

/** Plays the open step everywhere, and the click only at the commit. */
const FAKE: Recorder = {
  take: () => Promise.reject(new Error("not asked")),
  async run(base): Promise<Played> {
    const at = await mkdtemp(join(tmpdir(), "diffy-fake-run-"));
    const shot = join(at, "step-00.png");
    await Bun.write(shot, base);
    const opened = {
      label: "open /settings.html",
      shot,
      requests: [
        {
          method: "GET",
          url: "/settings.html",
          status: 200,
          type: "document",
          body: null,
        },
      ],
      console: [],
      ran: [{ path: "theme.js", lines: [[1, 3]] as [number, number][] }],
    };
    if (base.includes("parent")) {
      return {
        dir: at,
        steps: [opened],
        stopped: "step 1 (click #dark): no #dark",
      };
    }
    return {
      dir: at,
      steps: [opened, { ...opened, label: "click #dark", requests: [] }],
      stopped: null,
    };
  },
  close: async () => {},
};

async function call(args: Record<string, unknown>) {
  const route = mcpRoute(
    runTools(EvidenceStore.in(join(dir, "data")), FAKE, () => PULL),
    INSTRUCTIONS,
    async () => ({
      repo: { root: "/repo", store, topic: "t" },
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
        params: { name: "record_runs", arguments: args },
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

describe("recording runs", () => {
  test("keeps the steps the parent played, and why it stopped", async () => {
    // act
    const answer = await call({
      pull: 7,
      commit: "aaaa",
      after: "http://localhost:5001",
      before: "http://parent:5002",
      runs: [
        {
          id: "switching",
          name: "Turning it on",
          path: "/settings.html",
          steps: [{ do: "click", selector: "#dark" }],
        },
      ],
    });

    // assert
    expect(answer.isError).toBe(false);
    expect(answer.text).toContain("ran lines in theme.js");
    const [run] = runsOf(
      store.read().document.runs,
      "pull:o/r#7",
      "h".repeat(40),
    );
    expect(run?.after.steps.map((step) => step.label)).toEqual([
      "open /settings.html",
      "click #dark",
    ]);
    expect(run?.before?.steps).toHaveLength(1);
    expect(run?.before?.stopped).toContain("no #dark");
    expect(run?.after.steps[0]?.shot).toMatch(/^[0-9a-f]{64}\.png$/);
  });
});

describe("which file ran", () => {
  const step = (ran: [string, [number, number][]][]): PlayedStep => ({
    label: "open /",
    shot: "s.png",
    requests: [],
    console: [],
    ran: ran.map(([path, lines]) => ({ path, lines })),
  });

  test("paths on disk are read below the folder most of them share", () => {
    // arrange
    const files = new Set(["index.ts", "src/app.tsx", "src/view.tsx"]);
    const served = "/work/ws/";

    // act
    const [only] = againstFiles(
      [
        step([
          [`${served}src/app.tsx`, [[1, 2]]],
          [`${served}src/view.tsx`, [[4, 4]]],
          [`${served}node_modules/react/index.ts`, [[9, 9]]],
          ["src/app.tsx", [[3, 3]]],
          ["_bun/client/x.js", [[1, 1]]],
        ]),
      ],
      files,
    );

    // assert
    expect(only?.ran).toEqual([
      { path: "src/app.tsx", lines: [[1, 3]] },
      { path: "src/view.tsx", lines: [[4, 4]] },
    ]);
  });
});
// ~/~ end
