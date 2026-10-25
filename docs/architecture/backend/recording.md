# Recording

How diffy takes [captures](evidence.md#a-capture) for an agent. The agent
serves the app at a commit and at its parent, and hands diffy both
addresses and a recipe for each capture: where to start, what to do, and
which element shows each component. diffy drives a browser through the
recipe on both sides, takes a screenshot or a clip, measures each element,
and [attaches](evidence.md#the-tools) the result.

An agent can take its own pictures and attach them, and some will. But an
agent driving a browser by hand measures boxes, matches the two sides and
names files itself, and does it again for every new version. A recipe does
the same steps on both sides by construction, and the agent runs it again
as it is when the review moves on.

Serving the app stays with the agent. Only the repository knows how its
app starts, and an agent working in it already does; diffy only needs an
address for each side.

## A recipe

A recipe starts at a path, sets what the app keeps in local storage before
it loads, and takes steps; a shot is taken after the last one. Each
component the capture shows is named by a selector, and its box is
measured on the commit's side when the steps are done. In a clip, a
component shows from the end of a given step, so a click's effect can be
pointed at once it happens.

```ts
//| id: backend-evidence-recipe
//| file: src/backend/evidence/recipe.ts
import * as z from "zod";

export const Step = z.discriminatedUnion("do", [
  z.object({ do: z.literal("goto"), path: z.string() }),
  z.object({ do: z.literal("click"), selector: z.string() }),
  z.object({
    do: z.literal("fill"),
    selector: z.string(),
    text: z.string(),
  }),
  z.object({ do: z.literal("press"), key: z.string() }),
  z.object({ do: z.literal("wait"), ms: z.number().int().min(0).max(10_000) }),
]);
export type Step = z.infer<typeof Step>;

export const Recipe = z.object({
  path: z.string().default("/"),
  viewport: z
    .object({
      width: z.number().int().min(200).max(2560),
      height: z.number().int().min(200).max(2560),
    })
    .default({ width: 1280, height: 800 }),
  storage: z.record(z.string(), z.string()).default({}),
  steps: z.array(Step).default([]),
  clip: z.boolean().default(false),
});
export type Recipe = z.infer<typeof Recipe>;

/** What a recorder made of a recipe on one side. */
export interface Taken {
  /** The picture or clip, in a directory the caller removes. */
  file: string;
  /** The page's size in the pixels its boxes are measured in. */
  size: { width: number; height: number };
  /** Each selector asked for that matched, by selector. */
  boxes: Record<
    string,
    { x: number; y: number; width: number; height: number }
  >;
  /** Seconds into the clip at which each step was done. */
  done: number[];
  /** The clip's length in seconds, or 0 for a picture. */
  length: number;
}
```

## The recorder

One browser serves every recording, launched the first time one is asked
for, since most servers never record anything. Each recipe gets a context
of its own, so one side's storage and cookies never reach the other.

A shot is the whole page, not the window, so a component below the fold
still has its box; its boxes are measured in the page's coordinates. A clip
is the window as the steps play out, so its boxes are measured in the
window, after the last step. Playwright's clip starts with the page, so a
step's time is measured from the moment the page is made.

```ts
//| id: backend-evidence-recorder
//| file: src/backend/evidence/recorder.ts
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Browser, chromium, type Page } from "playwright-core";
import type { Recipe, Step, Taken } from "./recipe";

/** How long a step waits for its element before the recipe fails. */
const STEP_MS = 5000;

export interface Recorder {
  /** Plays `recipe` against the app at `base`, measuring `selectors`. */
  take(base: string, recipe: Recipe, selectors: string[]): Promise<Taken>;
  close(): Promise<void>;
}

export function playwrightRecorder(executablePath: string | null): Recorder {
  let browser: Promise<Browser> | null = null;
  // A browser that crashed or was killed is launched again on the next
  // recording, rather than failing every recording after it.
  const launched = async () => {
    const running = await browser?.catch(() => null);
    if (running?.isConnected()) return running;
    browser = chromium.launch(
      executablePath === null ? {} : { executablePath },
    );
    return browser;
  };
  return {
    async take(base, recipe, selectors) {
      const dir = await mkdtemp(join(tmpdir(), "diffy-recording-"));
      const context = await (await launched()).newContext({
        viewport: recipe.viewport,
        deviceScaleFactor: 1,
        ...(recipe.clip ? { recordVideo: { dir, size: recipe.viewport } } : {}),
      });
      try {
        await context.addInitScript((storage) => {
          for (const [key, value] of Object.entries(storage)) {
            localStorage.setItem(key, value);
          }
        }, recipe.storage);
        const page = await context.newPage();
        const start = Date.now();
        await settle(page, page.goto(new URL(recipe.path, base).href));
        const done: number[] = [];
        for (const [index, step] of recipe.steps.entries()) {
          await play(page, base, step).catch((error: Error) => {
            // Playwright follows its message with a coloured call log.
            const first = error.message.split("\n")[0];
            throw new Error(`step ${index + 1} (${step.do}): ${first}`);
          });
          done.push((Date.now() - start) / 1000);
        }
        const boxes = await measure(page, selectors, !recipe.clip);
        if (!recipe.clip) {
          const file = join(dir, "shot.png");
          await page.screenshot({ path: file, fullPage: true });
          const size = await page.evaluate(() => ({
            width: document.documentElement.scrollWidth,
            height: document.documentElement.scrollHeight,
          }));
          return { file, size, boxes, done, length: 0 };
        }
        // Hold the last frame a moment, so the clip ends on what it shows.
        await page.waitForTimeout(600);
        const length = (Date.now() - start) / 1000;
        const video = page.video();
        if (video === null) throw new Error("the browser made no clip");
        await page.close();
        // The clip is only whole once the page is closed; saving waits for
        // that, where its own path may name a file still being written.
        const file = join(dir, "clip.webm");
        await video.saveAs(file).catch(() => {
          throw new Error(
            "the browser made no clip; Playwright's ffmpeg is missing or the wrong build: install it with `playwright install ffmpeg`",
          );
        });
        return { file, size: recipe.viewport, boxes, done, length };
      } finally {
        await context.close();
      }
    },
    async close() {
      if (browser !== null) await (await browser).close();
    },
  };
}

async function play(page: Page, base: string, step: Step): Promise<void> {
  switch (step.do) {
    case "goto":
      return settle(page, page.goto(new URL(step.path, base).href));
    case "click":
      return settle(page, page.click(step.selector, { timeout: STEP_MS }));
    case "fill":
      return page.fill(step.selector, step.text, { timeout: STEP_MS });
    case "press":
      return settle(page, page.keyboard.press(step.key));
    case "wait":
      return page.waitForTimeout(step.ms);
  }
}

/** Waits for `action`, then for the page to stop fetching, up to a point:
 *  an app that polls never stops. */
async function settle(page: Page, action: Promise<unknown>): Promise<void> {
  await action;
  await page
    .waitForLoadState("networkidle", { timeout: 3000 })
    .catch(() => undefined);
  await page.waitForTimeout(200);
}

function measure(
  page: Page,
  selectors: string[],
  whole: boolean,
): Promise<Taken["boxes"]> {
  return page.evaluate(
    ({ selectors, whole }) => {
      const out: Record<
        string,
        { x: number; y: number; width: number; height: number }
      > = {};
      for (const selector of selectors) {
        const found = document.querySelector(selector);
        if (found === null) continue;
        const rect = found.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        out[selector] = {
          x: rect.left + (whole ? scrollX : 0),
          y: rect.top + (whole ? scrollY : 0),
          width: rect.width,
          height: rect.height,
        };
      }
      return out;
    },
    { selectors, whole },
  );
}
```

## The tool

`record_captures` takes every capture of a commit at once, so the agent
names the addresses once. The commit's side must play through: a step that
fails there is a broken recipe, and the agent is told which step. The
parent's side may not, since a commit often adds the page or the button
the recipe goes to; the capture then has nothing at the parent, and the
answer says why. A component whose selector matches nothing on the
commit's side is refused, as `attach_capture` refuses a box that leads
nowhere.

A clip's component shows from the end of its step to the end of the clip.
Its box is where the element was at the end, which is where a reader looks
once the clip stops.

```ts
//| id: backend-agent-recording
//| file: src/backend/agent/recording.ts
import { rm } from "node:fs/promises";
import { dirname } from "node:path";
import * as z from "zod";
import { Recipe, type Taken } from "../evidence/recipe";
import type { Recorder } from "../evidence/recorder";
import type { EvidenceStore } from "../evidence/store";
import type { RepoContext } from "../repo/repos";
import { attachCapture } from "./evidence";
import { type Tool, ToolError, tool } from "./mcp";
import { liveSources, type SeriesSources, Target } from "./series";

const Looked = z.object({
  component: z.string().min(1).describe("the component's id in the map"),
  selector: z
    .string()
    .min(1)
    .describe("a CSS selector for the element that draws it"),
  about: z.string().default("").describe("what to look for, in a few words"),
  from: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe(
      "for a clip, the step after which it shows, counting from 1; 0 for the whole clip",
    ),
});

const Planned = Recipe.extend({
  id: z
    .string()
    .min(1)
    .describe(
      "a short slug, the same in every version that captures the same thing",
    ),
  name: z.string().min(1).describe("what it shows: Settings"),
  state: z
    .array(z.string())
    .default([])
    .describe("the state of the app, a word or two each: dark, phone"),
  about: z.string().default("").describe("what to look for, a sentence"),
  shows: z.array(Looked).default([]),
});
type Planned = z.infer<typeof Planned>;

/** What a capture shows, from the commit's side as the recorder took it. */
export function showsOf(planned: Planned, taken: Taken) {
  return planned.shows.map((each) => {
    const box = taken.boxes[each.selector];
    if (box === undefined) {
      throw new ToolError(
        `${planned.id}: nothing on the page at the commit matches ${each.selector}, which should show ${each.component}`,
      );
    }
    return {
      component: each.component,
      about: each.about,
      box,
      ...(planned.clip
        ? {
            at: {
              start: each.from === 0 ? 0 : (taken.done[each.from - 1] ?? 0),
              end: taken.length,
            },
          }
        : {}),
    };
  });
}

export function recordingTools(
  store: EvidenceStore,
  recorder: Recorder,
  sourcesOf: (repo: RepoContext) => SeriesSources = liveSources,
): Tool[] {
  return [
    tool({
      name: "record_captures",
      description:
        "Record screenshots or clips of the app for a commit of the newest version of a local review or a pull request, and attach them. Serve the app at the commit and at its parent yourself, each on its own port, and give their addresses. diffy plays each recipe on both sides in a browser, measures each component's element by its selector, and attaches the result as attach_capture would. Write the version's component map first.",
      input: z.object({
        ...Target,
        commit: z
          .string()
          .min(1)
          .describe("the change id or commit id it shows, or a prefix"),
        after: z
          .string()
          .url()
          .describe(
            "where the app is served at the commit: http://localhost:5001",
          ),
        before: z
          .string()
          .url()
          .optional()
          .describe("where it is served at the commit's parent, if it can be"),
        captures: z.array(Planned).min(1),
      }),
      call: async (input, context) => {
        const { after: at, before: parent, captures, ...named } = input;
        const lines: string[] = [];
        for (const planned of captures) {
          const selectors = planned.shows.map((each) => each.selector);
          const after = await recorder
            .take(at, planned, selectors)
            .catch((error: Error) => {
              throw new ToolError(
                `${planned.id} did not play at the commit: ${error.message}`,
              );
            });
          let before: Taken | null = null;
          let missed: string | null = null;
          if (parent !== undefined) {
            try {
              before = await recorder.take(parent, planned, []);
            } catch (error) {
              missed = (error as Error).message;
            }
          }
          try {
            const attached = await attachCapture(
              {
                ...named,
                id: planned.id,
                name: planned.name,
                state: planned.state,
                about: planned.about,
                after: after.file,
                ...(before === null ? {} : { before: before.file }),
                size: after.size,
                shows: showsOf(planned, after),
              },
              context,
              store,
              sourcesOf(context.repo),
            );
            lines.push(
              missed === null
                ? attached
                : `${attached}\nnothing at the parent: ${missed}`,
            );
          } finally {
            for (const taken of [after, before]) {
              if (taken !== null) {
                await rm(dirname(taken.file), { recursive: true, force: true });
              }
            }
          }
        }
        return lines.join("\n");
      },
    }),
  ];
}
```

## Tests

The tool is tested against a recorder that hands back a file it wrote,
since a browser is not there in every test run; the recorder itself is
proven by the recordings an agent attaches.

```ts
//| id: backend-agent-recording-test
//| file: src/backend/agent/recording.test.ts
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
```
