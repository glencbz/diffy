# Runs

A run is [evidence](evidence.md) of what a change does rather than how it
looks: a [recipe](recording.md#a-recipe) played step by step, keeping, for
every step, a picture of the window, the requests the page made, what it
wrote to the console, and the lines of the repository it ran. Like a
capture it is taken at a commit and at its parent, so a reader can see a
request appear, an error go away, or a function start running.

## A run

A run belongs to one commit of one version and keeps its id across
versions, as a capture does. Its first step is the page opening; each step
of the recipe follows, labelled by what the agent called it or by what it
did. A side that stopped part way keeps the steps it played and says why it
stopped, since the steps before a button the commit adds are still worth
comparing.

The lines a step ran are kept as runs of line numbers per file, on the
commit's side of the code, so the [code](../frontend/runs.md) can light
them without measuring anything again.

```ts
//| id: frontend-model-runs
//| file: src/frontend/model/runs.ts
import * as z from "zod";
import { BlobName } from "./evidence";

export const Request = z.object({
  method: z.string(),
  /** The path and query, or the whole address for another origin. */
  url: z.string(),
  /** Null when no answer came. */
  status: z.number().int().nullable(),
  /** What the browser fetched it as: document, script, fetch... */
  type: z.string(),
  /** The answer to a fetch, as text, cut short past a limit. */
  body: z.string().nullable(),
});
export type Request = z.infer<typeof Request>;

export const Logged = z.object({
  level: z.enum(["log", "info", "warn", "error", "debug"]),
  text: z.string(),
});
export type Logged = z.infer<typeof Logged>;

/** The lines of one file a step ran, as inclusive runs, in order. */
export const Ran = z.object({
  path: z.string(),
  lines: z.array(z.tuple([z.number().int(), z.number().int()])),
});
export type Ran = z.infer<typeof Ran>;

export const RunStep = z.object({
  label: z.string(),
  /** The window once the step settled. */
  shot: BlobName,
  requests: z.array(Request),
  console: z.array(Logged),
  ran: z.array(Ran),
});
export type RunStep = z.infer<typeof RunStep>;

export const RunSide = z.object({
  steps: z.array(RunStep),
  /** Why the side stopped before its last step, or null. */
  stopped: z.string().nullable(),
});
export type RunSide = z.infer<typeof RunSide>;

export const Run = z.object({
  series: z.string(),
  version: z.string(),
  commitId: z.string(),
  /** The same in every version that has it. */
  id: z.string().min(1),
  name: z.string().min(1),
  state: z.array(z.string()).default([]),
  about: z.string().default(""),
  /** At the commit's parent, when there is one to play. */
  before: RunSide.nullable(),
  after: RunSide,
  recordedAt: z.string(),
});
export type Run = z.infer<typeof Run>;

const sameRun = (a: Run, b: Run) =>
  a.series === b.series &&
  a.version === b.version &&
  a.commitId === b.commitId &&
  a.id === b.id;

/** `runs` with `run` in place of any of its commit's with its id. */
export function withRun(runs: Run[], run: Run): Run[] {
  return [...runs.filter((each) => !sameRun(each, run)), run];
}

/** The runs of one version of a series, in the order they came. */
export function runsOf(runs: Run[], series: string, version: string): Run[] {
  return runs.filter(
    (each) => each.series === series && each.version === version,
  );
}

/** Turns line numbers into inclusive runs, in order. */
export function lineRuns(lines: Iterable<number>): [number, number][] {
  const sorted = [...new Set(lines)].sort((a, b) => a - b);
  const out: [number, number][] = [];
  for (const line of sorted) {
    const last = out.at(-1);
    if (last !== undefined && last[1] === line - 1) last[1] = line;
    else out.push([line, line]);
  }
  return out;
}
```

## Playing a run

Every step is read the moment it settles. The browser's precise coverage
and its stylesheet rule tracking each hand back what ran since they were
last asked and start counting afresh, so asking after every step gives
that step's lines alone, without diffing totals. Both start before the page
loads, so the page's own scripts count towards the step that opened it.

Coverage comes as character ranges with counts, the innermost range
deciding each character. A line ran when any of its characters other than
spaces did. A script inline in a page starts part way down the page's
file, and its lines are shifted to match.

A script or stylesheet is kept against the repository by the path of its
address, so `/theme.js` is `theme.js`; one from another origin, or made by
the page itself, belongs to no file and is left out. An app that bundles
its code serves files the repository does not have, and its lines would
need its source maps, which a run does not read yet.

```ts
//| id: backend-evidence-play-run
//| file: src/backend/evidence/playRun.ts
import { join } from "node:path";
import type { CDPSession, Page } from "playwright-core";
import {
  type Logged,
  lineRuns,
  type Ran,
  type Request,
} from "../../frontend/model/runs";
import type { Step } from "./recipe";

/** How much of a fetch's answer a step keeps. */
const BODY_LIMIT = 16 * 1024;

/** A step as the run file holds it, before its picture is stored. */
export interface PlayedStep {
  label: string;
  shot: string;
  requests: Request[];
  console: Logged[];
  ran: Ran[];
}

interface Source {
  path: string;
  /** The first line of the script within its file, counting from 0. */
  startLine: number;
  text: string | null;
}

/** Watches one page: its requests and console as they come, and what each
 *  step ran, read and reset after it. */
export async function watch(page: Page, base: string) {
  const origin = new URL(base).origin;
  const cdp: CDPSession = await page.context().newCDPSession(page);
  const scripts = new Map<string, Source>();
  const sheets = new Map<string, Source>();
  const pathOf = (url: string): string | null => {
    if (url === "") return null;
    const at = new URL(url, base);
    if (at.origin !== origin) return null;
    const path = decodeURIComponent(at.pathname).replace(/^\//, "");
    return path === "" || path.endsWith("/") ? `${path}index.html` : path;
  };
  cdp.on("Debugger.scriptParsed", (event) => {
    const path = pathOf(event.url);
    if (path !== null) {
      scripts.set(event.scriptId, {
        path,
        startLine: event.startLine,
        text: null,
      });
    }
  });
  cdp.on("CSS.styleSheetAdded", ({ header }) => {
    const path = pathOf(header.sourceURL);
    if (path !== null) {
      sheets.set(header.styleSheetId, {
        path,
        startLine: header.startLine,
        text: null,
      });
    }
  });
  await cdp.send("Debugger.enable");
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.startPreciseCoverage", {
    callCount: true,
    detailed: true,
  });
  await cdp.send("DOM.enable");
  await cdp.send("CSS.enable");
  await cdp.send("CSS.startRuleUsageTracking");

  let requests: Request[] = [];
  let logged: Logged[] = [];
  page.on("response", async (response) => {
    const request = response.request();
    const type = request.resourceType();
    let body: string | null = null;
    if (type === "fetch" || type === "xhr") {
      body = await response
        .text()
        .then((text) => text.slice(0, BODY_LIMIT))
        .catch(() => null);
    }
    requests.push({
      method: request.method(),
      url: shortUrl(request.url(), origin),
      status: response.status(),
      type,
      body,
    });
  });
  page.on("requestfailed", (request) => {
    requests.push({
      method: request.method(),
      url: shortUrl(request.url(), origin),
      status: null,
      type: request.resourceType(),
      body: null,
    });
  });
  page.on("console", (message) => {
    const type = message.type();
    const level = (
      ["log", "info", "warn", "error", "debug"].includes(type) ? type : "log"
    ) as Logged["level"];
    logged.push({ level, text: message.text() });
  });
  page.on("pageerror", (error) => {
    logged.push({ level: "error", text: error.message });
  });

  const textOf = async (
    sources: Map<string, Source>,
    id: string,
    read: () => Promise<string>,
  ): Promise<Source | null> => {
    const source = sources.get(id);
    if (source === undefined) return null;
    source.text ??= await read().catch(() => "");
    return source;
  };

  /** What ran and what came since the last step, read and reset. */
  const step = async (label: string, shot: string): Promise<PlayedStep> => {
    await page.screenshot({ path: shot });
    const lines = new Map<string, Set<number>>();
    const add = (path: string, numbers: number[]) => {
      const set = lines.get(path) ?? new Set<number>();
      for (const number of numbers) set.add(number);
      lines.set(path, set);
    };
    const { result } = await cdp.send("Profiler.takePreciseCoverage");
    for (const script of result) {
      if (!script.functions.some((fn) => fn.ranges.some((r) => r.count > 0))) {
        continue;
      }
      const source = await textOf(
        scripts,
        script.scriptId,
        async () =>
          (
            await cdp.send("Debugger.getScriptSource", {
              scriptId: script.scriptId,
            })
          ).scriptSource,
      );
      if (source?.text == null) continue;
      add(
        source.path,
        linesRun(
          source.text,
          script.functions.flatMap((fn) => fn.ranges),
          source.startLine,
        ),
      );
    }
    const { coverage: ruleUsage } = await cdp.send("CSS.takeCoverageDelta");
    for (const rule of ruleUsage) {
      if (!rule.used) continue;
      const source = await textOf(
        sheets,
        rule.styleSheetId,
        async () =>
          (
            await cdp.send("CSS.getStyleSheetText", {
              styleSheetId: rule.styleSheetId,
            })
          ).text,
      );
      if (source?.text == null) continue;
      add(
        source.path,
        linesRun(
          source.text,
          [
            {
              startOffset: rule.startOffset,
              endOffset: rule.endOffset,
              count: 1,
            },
          ],
          source.startLine,
        ),
      );
    }
    const played: PlayedStep = {
      label,
      shot,
      requests,
      console: logged,
      ran: [...lines]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([path, numbers]) => ({ path, lines: lineRuns(numbers) })),
    };
    requests = [];
    logged = [];
    return played;
  };

  return { step };
}

/** The lines, counting from 1, whose characters other than spaces ran:
 *  later ranges sit inside earlier ones and decide their characters. */
export function linesRun(
  text: string,
  ranges: { startOffset: number; endOffset: number; count: number }[],
  startLine = 0,
): number[] {
  const counts = new Int32Array(text.length).fill(-1);
  for (const range of ranges) {
    counts.fill(
      range.count,
      range.startOffset,
      Math.min(range.endOffset, text.length),
    );
  }
  const out = new Set<number>();
  let line = startLine + 1;
  for (let at = 0; at < text.length; at++) {
    const char = text[at];
    if (char === "\n") {
      line++;
      continue;
    }
    if (
      (counts[at] ?? 0) > 0 &&
      char !== " " &&
      char !== "\t" &&
      char !== "\r"
    ) {
      out.add(line);
    }
  }
  return [...out];
}

/** A step's label: the agent's, or what the step does. */
export function labelOf(step: Step & { label?: string }): string {
  if (step.label !== undefined) return step.label;
  switch (step.do) {
    case "goto":
      return `open ${step.path}`;
    case "click":
      return `click ${step.selector}`;
    case "fill":
      return `type into ${step.selector}`;
    case "press":
      return `press ${step.key}`;
    case "wait":
      return `wait ${step.ms}ms`;
  }
}

function shortUrl(url: string, origin: string): string {
  const at = new URL(url);
  return at.origin === origin ? `${at.pathname}${at.search}` : url;
}

/** Where a run keeps the picture of its step `index`. */
export const shotPath = (dir: string, index: number) =>
  join(dir, `step-${String(index).padStart(2, "0")}.png`);
```

The recorder plays a run on the browser it records captures with. A step
that fails ends the side: on the parent that is expected, and the steps it
did play are kept; on the commit the tool refuses the run.

```ts
//| id: backend-evidence-recorder-run
//| file: src/backend/evidence/recordRun.ts
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Browser } from "playwright-core";
import { labelOf, type PlayedStep, shotPath, watch } from "./playRun";
import type { Recipe, Step } from "./recipe";
import { play, settle } from "./recorder";

export interface Played {
  /** A directory the caller removes. */
  dir: string;
  steps: PlayedStep[];
  stopped: string | null;
}

export async function recordRun(
  browser: Browser,
  base: string,
  recipe: Recipe & { steps: (Step & { label?: string })[] },
): Promise<Played> {
  const dir = await mkdtemp(join(tmpdir(), "diffy-run-"));
  const context = await browser.newContext({
    viewport: recipe.viewport,
    deviceScaleFactor: 1,
  });
  try {
    await context.addInitScript((storage) => {
      for (const [key, value] of Object.entries(storage)) {
        localStorage.setItem(key, value);
      }
    }, recipe.storage);
    const page = await context.newPage();
    const watching = await watch(page, base);
    const steps: PlayedStep[] = [];
    try {
      await settle(page, page.goto(new URL(recipe.path, base).href));
    } catch (error) {
      return { dir, steps, stopped: `open: ${firstLine(error)}` };
    }
    steps.push(await watching.step(`open ${recipe.path}`, shotPath(dir, 0)));
    for (const [index, step] of recipe.steps.entries()) {
      try {
        await play(page, base, step);
      } catch (error) {
        return {
          dir,
          steps,
          stopped: `step ${index + 1} (${labelOf(step)}): ${firstLine(error)}`,
        };
      }
      steps.push(await watching.step(labelOf(step), shotPath(dir, index + 1)));
    }
    return { dir, steps, stopped: null };
  } finally {
    await context.close();
  }
}

// Playwright follows its message with a coloured call log.
const firstLine = (error: unknown) =>
  ((error as Error).message ?? String(error)).split("\n")[0];
```

## The tool

`record_runs` takes the same addresses and recipes as
[`record_captures`](recording.md#the-tool), with a label on any step worth
naming. It stores each step's picture with the other evidence, and the run
replaces any of its commit's with the same id.

```ts
//| id: backend-agent-runs
//| file: src/backend/agent/runs.ts
import { rm } from "node:fs/promises";
import * as z from "zod";
import type { Run, RunSide, RunStep } from "../../frontend/model/runs";
import { Recipe, Step } from "../evidence/recipe";
import type { Recorder } from "../evidence/recorder";
import type { Played } from "../evidence/recordRun";
import type { EvidenceStore } from "../evidence/store";
import type { RepoContext } from "../repo/repos";
import { type Tool, ToolError, tool } from "./mcp";
import {
  commitNamed,
  liveSources,
  type SeriesSources,
  short,
  Target,
  targetOf,
} from "./series";

const Labelled = z.intersection(
  Step,
  z.object({
    label: z
      .string()
      .min(1)
      .optional()
      .describe("what the step is, for the reader: Turn the dark theme on"),
  }),
);

const Planned = Recipe.extend({
  id: z
    .string()
    .min(1)
    .describe(
      "a short slug, the same in every version that runs the same thing",
    ),
  name: z.string().min(1).describe("what it does: Turning the theme on"),
  state: z.array(z.string()).default([]),
  about: z.string().default("").describe("what to look for, a sentence"),
  steps: z.array(Labelled).default([]),
});

export function runTools(
  store: EvidenceStore,
  recorder: Recorder,
  sourcesOf: (repo: RepoContext) => SeriesSources = liveSources,
): Tool[] {
  return [
    tool({
      name: "record_runs",
      description:
        "Play recipes against the app at a commit and at its parent, and attach each as a run: per step, a picture of the window, the requests the page made, what it wrote to the console, and the lines of the repository it ran. Serve each side yourself, each on its own port. Use it for a change whose effect is in what the app does: a request, an error, which code runs.",
      input: z.object({
        ...Target,
        commit: z
          .string()
          .min(1)
          .describe("the change id or commit id, or a prefix"),
        after: z
          .string()
          .url()
          .describe("where the app is served at the commit"),
        before: z
          .string()
          .url()
          .optional()
          .describe("where it is served at the commit's parent, if it can be"),
        runs: z.array(Planned).min(1),
      }),
      call: async (input, { repo, link, now }) => {
        const target = await targetOf(sourcesOf(repo), input);
        const commit = commitNamed(target, input.commit);
        const lines: string[] = [link(target.path)];
        for (const planned of input.runs) {
          const after = await recorder.run(input.after, planned);
          const before =
            input.before === undefined
              ? null
              : await recorder.run(input.before, planned);
          try {
            if (after.stopped !== null) {
              throw new ToolError(
                `${planned.id} did not play at the commit: ${after.stopped}`,
              );
            }
            const run: Run = {
              series: target.series,
              version: target.version,
              commitId: commit.commitId,
              id: planned.id,
              name: planned.name,
              state: planned.state,
              about: planned.about,
              before: before === null ? null : await stored(store, before),
              after: await stored(store, after),
              recordedAt: now().toISOString(),
            };
            repo.store.apply({ kind: "record-run", run });
            const ran = new Set(
              run.after.steps.flatMap((step) => step.ran.map((r) => r.path)),
            );
            lines.push(
              `${planned.id} is attached to ${short(commit)} in ${target.label}: ${run.after.steps.length} steps, ${run.after.steps.reduce((sum, step) => sum + step.requests.length, 0)} requests, ran lines in ${ran.size === 0 ? "no file of the repository" : [...ran].join(", ")}${before?.stopped ? `\nthe parent stopped at ${before.stopped}` : ""}`,
            );
          } finally {
            for (const played of [after, before]) {
              if (played !== null) {
                await rm(played.dir, { recursive: true, force: true });
              }
            }
          }
        }
        return lines.join("\n");
      },
    }),
  ];
}

async function stored(store: EvidenceStore, played: Played): Promise<RunSide> {
  const steps: RunStep[] = [];
  for (const step of played.steps) {
    const put = await store.put(step.shot);
    if ("refused" in put) throw new ToolError(put.refused);
    steps.push({ ...step, shot: put.name });
  }
  return { steps, stopped: played.stopped };
}
```

## Tests

The line arithmetic is tested on its own; the tool against a recorder that
plays nothing, as [recording](recording.md#tests) is.

```ts
//| id: backend-evidence-play-run-test
//| file: src/backend/evidence/playRun.test.ts
import { describe, expect, test } from "bun:test";
import { lineRuns } from "../../frontend/model/runs";
import { labelOf, linesRun } from "./playRun";

describe("the lines a step ran", () => {
  test("the innermost range decides, and blank characters do not count", () => {
    // arrange
    const text = "function f() {\n  if (x) {\n    y();\n  }\n}\nf();\n";

    // act
    const lines = linesRun(text, [
      { startOffset: 0, endOffset: text.length, count: 1 },
      { startOffset: 24, endOffset: 39, count: 0 },
    ]);

    // assert
    expect(lines).toEqual([1, 2, 5, 6]);
  });

  test("an inline script's lines start where it does in its page", () => {
    // act
    const lines = linesRun(
      "a();\n",
      [{ startOffset: 0, endOffset: 4, count: 1 }],
      9,
    );

    // assert
    expect(lines).toEqual([10]);
  });

  test("line numbers fold into runs", () => {
    // act
    const runs = lineRuns([5, 1, 2, 3, 9, 2]);

    // assert
    expect(runs).toEqual([
      [1, 3],
      [5, 5],
      [9, 9],
    ]);
  });

  test("a step is labelled by what it does unless named", () => {
    // act
    const labels = [
      labelOf({ do: "click", selector: "#dark" }),
      labelOf({ do: "press", key: "Enter", label: "Submit" }),
    ];

    // assert
    expect(labels).toEqual(["click #dark", "Submit"]);
  });
});
```

```ts
//| id: backend-agent-runs-test
//| file: src/backend/agent/runs.test.ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runsOf } from "../../frontend/model/runs";
import type { Recorder } from "../evidence/recorder";
import type { Played } from "../evidence/recordRun";
import { EvidenceStore } from "../evidence/store";
import { openReviewStore, type ReviewStore } from "../review/store";
import { mcpRoute } from "./mcp";
import { INSTRUCTIONS } from "./review";
import { runTools } from "./runs";
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
```
