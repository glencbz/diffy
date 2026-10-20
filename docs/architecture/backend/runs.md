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

The lines a step ran are kept as runs of line numbers per file of the
commit the side played, so the [code](../frontend/runs.md) can light them
without measuring anything again.

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

A script or stylesheet names the file it came from by the path of its
address, so `/theme.js` is `theme.js`; one from another origin, or made by
the page itself, names none and is left out. One with a
[source map](#code-a-bundler-made) names the files its map points into
instead. Which of the repository's files a name means is
[the tool's](#which-file-ran) to settle, since only it knows the commit.

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
import {
  mappedLinesRun,
  ranChars,
  readSourceMap,
  type SourceMap,
} from "./sourceMap";

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
  /** Where its source map is, resolved, or null. */
  mapUrl: string | null;
  text: string | null;
  /** Read with the text; null when it has none or it cannot be read. */
  map: SourceMap | null;
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
  const sourceOf = (
    url: string,
    startLine: number,
    mapUrl: string | undefined,
  ): Source | null => {
    const path = pathOf(url);
    if (path === null) return null;
    return {
      path,
      startLine,
      mapUrl: mapUrl ? new URL(mapUrl, new URL(url, base)).href : null,
      text: null,
      map: null,
    };
  };
  /** A file a map points into: its path on disk, or as `pathOf` names it. */
  const mappedPath = (source: string, mapUrl: string): string | null => {
    const at = new URL(source, mapUrl);
    return at.protocol === "file:"
      ? decodeURIComponent(at.pathname)
      : pathOf(at.href);
  };
  cdp.on("Debugger.scriptParsed", (event) => {
    const source = sourceOf(event.url, event.startLine, event.sourceMapURL);
    if (source !== null) scripts.set(event.scriptId, source);
  });
  cdp.on("CSS.styleSheetAdded", ({ header }) => {
    const source = sourceOf(
      header.sourceURL,
      header.startLine,
      header.sourceMapURL,
    );
    if (source !== null) sheets.set(header.styleSheetId, source);
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

  const readMap = async (url: string): Promise<string> =>
    url.startsWith("data:")
      ? (await fetch(url)).text()
      : (await page.context().request.get(url)).text();
  const textOf = async (
    sources: Map<string, Source>,
    id: string,
    read: () => Promise<string>,
  ): Promise<Source | null> => {
    const source = sources.get(id);
    if (source === undefined) return null;
    if (source.text === null) {
      source.text = await read().catch(() => "");
      if (source.mapUrl !== null) {
        source.map = readSourceMap(
          await readMap(source.mapUrl).catch(() => ""),
        );
      }
    }
    return source;
  };

  /** What ran and what came since the last step, read and reset. */
  const step = async (label: string, shot: string): Promise<PlayedStep> => {
    await page.screenshot({ path: shot });
    const lines = new Map<string, Set<number>>();
    const add = (path: string, numbers: Iterable<number>) => {
      const set = lines.get(path) ?? new Set<number>();
      for (const number of numbers) set.add(number);
      lines.set(path, set);
    };
    const addRan = (source: Source, ranges: CoveredRange[]) => {
      if (source.text === null) return;
      if (source.map === null || source.mapUrl === null) {
        add(source.path, linesRun(source.text, ranges, source.startLine));
        return;
      }
      const { map, mapUrl } = source;
      for (const [index, numbers] of mappedLinesRun(source.text, ranges, map)) {
        const path = mappedPath(map.sources[index] ?? "", mapUrl);
        if (path !== null) add(path, numbers);
      }
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
      if (source === null) continue;
      addRan(
        source,
        script.functions.flatMap((fn) => fn.ranges),
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
      if (source === null) continue;
      addRan(source, [
        { startOffset: rule.startOffset, endOffset: rule.endOffset, count: 1 },
      ]);
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

type CoveredRange = { startOffset: number; endOffset: number; count: number };

/** The lines, counting from 1, whose characters other than spaces ran. */
export function linesRun(
  text: string,
  ranges: CoveredRange[],
  startLine = 0,
): number[] {
  const ran = ranChars(text, ranges);
  const out = new Set<number>();
  let line = startLine + 1;
  for (let at = 0; at < text.length; at++) {
    if (text[at] === "\n") line++;
    else if (ran[at] === 1) out.add(line);
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

### Code a bundler made

A bundled script's lines are the bundler's, not the repository's, so a
script or stylesheet that names a source map has its ran characters carried
back through the map. Each mapping covers the generated characters up to the
next one on its line; it ran when any of those did, and then its original
line ran. The recorder reads the map while the page is open, through the
page's own browser context, so a map behind the app's address loads as the
page would load it.

The decoder is a few lines of its own. The `source-map` package is
asynchronous, ships WebAssembly, and answers one position at a time, when a
step needs every mapping of a bundle. An index map, made of sections, is not
read; its script falls back to its own address and so to no file.

```ts
//| id: backend-evidence-source-map
//| file: src/backend/evidence/sourceMap.ts
import * as z from "zod";

const SourceMapFile = z.object({
  version: z.literal(3),
  sourceRoot: z.string().optional(),
  sources: z.array(z.string().nullable()),
  mappings: z.string(),
});

export interface SourceMap {
  /** Each source's address, the source root already in front. */
  sources: string[];
  mappings: string;
}

/** A map's text read, or null when it is not one this can read. */
export function readSourceMap(text: string): SourceMap | null {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = SourceMapFile.safeParse(json);
  if (!parsed.success) return null;
  const root = parsed.data.sourceRoot ?? "";
  const joined = root === "" || root.endsWith("/") ? root : `${root}/`;
  return {
    sources: parsed.data.sources.map((source) => `${joined}${source ?? ""}`),
    mappings: parsed.data.mappings,
  };
}

/** Where a run of generated characters came from, counting from 0. */
export interface Segment {
  column: number;
  /** Null for characters that came from no source. */
  source: number | null;
  line: number;
}

const DIGITS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** The segments of each generated line, in column order. */
export function decodeMappings(mappings: string): Segment[][] {
  const out: Segment[][] = [[]];
  // Every field is relative to the one before it; only the generated
  // column starts again on each line.
  let column = 0;
  let source = 0;
  let line = 0;
  let fields: number[] = [];
  let value = 0;
  let shift = 0;
  const end = () => {
    const [generated, toSource, toLine] = fields;
    if (generated === undefined) return;
    column += generated;
    if (toSource !== undefined && toLine !== undefined) {
      source += toSource;
      line += toLine;
      out.at(-1)?.push({ column, source, line });
    } else {
      out.at(-1)?.push({ column, source: null, line: 0 });
    }
    fields = [];
  };
  for (const char of mappings) {
    if (char === ",") {
      end();
    } else if (char === ";") {
      end();
      out.push([]);
      column = 0;
    } else {
      const digit = DIGITS.indexOf(char);
      value += (digit & 31) << shift;
      if (digit & 32) {
        shift += 5;
      } else {
        fields.push(value & 1 ? -(value >>> 1) : value >>> 1);
        value = 0;
        shift = 0;
      }
    }
  }
  end();
  return out;
}

/** 1 for each character that ran and is not blank: later ranges sit
 *  inside earlier ones and decide their characters. */
export function ranChars(
  text: string,
  ranges: { startOffset: number; endOffset: number; count: number }[],
): Uint8Array {
  const counts = new Int32Array(text.length).fill(-1);
  for (const range of ranges) {
    counts.fill(
      range.count,
      range.startOffset,
      Math.min(range.endOffset, text.length),
    );
  }
  const ran = new Uint8Array(text.length);
  for (let at = 0; at < text.length; at++) {
    const char = text[at];
    if (
      (counts[at] ?? 0) > 0 &&
      char !== " " &&
      char !== "\t" &&
      char !== "\r" &&
      char !== "\n"
    ) {
      ran[at] = 1;
    }
  }
  return ran;
}

/** The original lines, counting from 1, that ran, by index into the map's
 *  sources. */
export function mappedLinesRun(
  text: string,
  ranges: { startOffset: number; endOffset: number; count: number }[],
  map: SourceMap,
): Map<number, Set<number>> {
  const ran = ranChars(text, ranges);
  const out = new Map<number, Set<number>>();
  let start = 0;
  for (const segments of decodeMappings(map.mappings)) {
    if (start > text.length) break;
    const newline = text.indexOf("\n", start);
    const end = newline === -1 ? text.length : newline;
    for (const [index, segment] of segments.entries()) {
      if (segment.source === null) continue;
      const from = start + segment.column;
      const to = Math.min(
        end,
        start + (segments[index + 1]?.column ?? end - start),
      );
      if (from < to && ran.subarray(from, to).includes(1)) {
        const lines = out.get(segment.source) ?? new Set<number>();
        lines.add(segment.line + 1);
        out.set(segment.source, lines);
      }
    }
    start = end + 1;
  }
  return out;
}
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

### Which file ran

A name a step ran under is matched to a file of the commit the side played,
read from git so a pull request's commits work too. A name from the app's
address is the file of the same path. A path on disk, which a bundler's map
gives, is under whatever folder the app was served from, which the tool is
never told; it is taken to be the folder most of the paths sit in when read
as files of the commit. Anything else under that folder, such as
`node_modules`, matches no file and is left out, as are names that match
none.

Matching each path by the longest file it ends with would need no folder,
but would take a dependency's `index.js` for the repository's.

```ts
//| id: backend-agent-runs
//| file: src/backend/agent/runs.ts
import { rm } from "node:fs/promises";
import * as z from "zod";
import {
  lineRuns,
  type Ran,
  type Run,
  type RunSide,
  type RunStep,
} from "../../frontend/model/runs";
import type { PlayedStep } from "../evidence/playRun";
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
        const sources = sourcesOf(repo);
        const target = await targetOf(sources, input);
        const commit = commitNamed(target, input.commit);
        const afterFiles = new Set(await sources.files(commit.commitId));
        const beforeFiles = new Set(
          input.before === undefined
            ? []
            : await sources.files(`${commit.commitId}^`),
        );
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
              before:
                before === null
                  ? null
                  : await stored(store, before, beforeFiles),
              after: await stored(store, after, afterFiles),
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

async function stored(
  store: EvidenceStore,
  played: Played,
  files: Set<string>,
): Promise<RunSide> {
  const steps: RunStep[] = [];
  for (const step of againstFiles(played.steps, files)) {
    const put = await store.put(step.shot);
    if ("refused" in put) throw new ToolError(put.refused);
    steps.push({ ...step, shot: put.name });
  }
  return { steps, stopped: played.stopped };
}

/** `steps` with each name they ran under turned into a file of `files`,
 *  and the names that are none left out. */
export function againstFiles(
  steps: PlayedStep[],
  files: Set<string>,
): PlayedStep[] {
  const folder = servedFrom(
    steps.flatMap((step) => step.ran.map((ran) => ran.path)),
    files,
  );
  const fileOf = (path: string): string | null => {
    if (!path.startsWith("/")) return files.has(path) ? path : null;
    if (folder === null || !path.startsWith(folder)) return null;
    const file = path.slice(folder.length);
    return files.has(file) ? file : null;
  };
  return steps.map((step) => {
    const lines = new Map<string, number[]>();
    for (const ran of step.ran) {
      const file = fileOf(ran.path);
      if (file === null) continue;
      const numbers = lines.get(file) ?? [];
      for (const [from, to] of ran.lines) {
        for (let line = from; line <= to; line++) numbers.push(line);
      }
      lines.set(file, numbers);
    }
    const ran: Ran[] = [...lines]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([path, numbers]) => ({ path, lines: lineRuns(numbers) }));
    return { ...step, ran };
  });
}

/** The folder, ending in `/`, that most of the paths on disk sit in when
 *  read as `files`, or null when none does. */
function servedFrom(paths: string[], files: Set<string>): string | null {
  const votes = new Map<string, number>();
  for (const path of new Set(paths)) {
    if (!path.startsWith("/")) continue;
    for (
      let at = path.indexOf("/");
      at !== -1;
      at = path.indexOf("/", at + 1)
    ) {
      if (files.has(path.slice(at + 1))) {
        const folder = path.slice(0, at + 1);
        votes.set(folder, (votes.get(folder) ?? 0) + 1);
      }
    }
  }
  let best: string | null = null;
  for (const [folder, count] of votes) {
    if (best === null || count > (votes.get(best) ?? 0)) best = folder;
  }
  return best;
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

A bundle Bun builds is the fixture for source maps, so the decoder is read
against the maps the apps it serves carry.

```ts
//| id: backend-evidence-source-map-test
//| file: src/backend/evidence/sourceMap.test.ts
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeMappings, mappedLinesRun, readSourceMap } from "./sourceMap";

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "diffy-source-map-"));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("source maps", () => {
  test("segments carry their fields across lines", () => {
    // act
    const lines = decodeMappings("AAAA,IAAI;AACA,EAAE;;C");

    // assert
    expect(lines).toEqual([
      [
        { column: 0, source: 0, line: 0 },
        { column: 4, source: 0, line: 0 },
      ],
      [
        { column: 0, source: 0, line: 1 },
        { column: 2, source: 0, line: 1 },
      ],
      [],
      [{ column: 1, source: null, line: 0 }],
    ]);
  });

  test("the characters that ran in a bundle light their original lines", async () => {
    // arrange
    await Bun.write(
      join(dir, "shout.ts"),
      'export function shout(s: string): string {\n  return s.toUpperCase() + "!";\n}\n',
    );
    await Bun.write(
      join(dir, "main.ts"),
      'import { shout } from "./shout";\n\nconst unused = 1;\ndocument.title = shout("hi");\n',
    );
    const built = await Bun.build({
      entrypoints: [join(dir, "main.ts")],
      sourcemap: "external",
    });
    const bundle = built.outputs.find((out) => out.kind === "entry-point");
    const map = readSourceMap((await bundle?.sourcemap?.text()) ?? "");
    const text = (await bundle?.text()) ?? "";
    if (map === null) throw new Error("Bun.build wrote no map");
    const call = text.indexOf("toUpperCase");

    // act
    const ran = mappedLinesRun(
      text,
      [{ startOffset: call, endOffset: call + 11, count: 1 }],
      map,
    );

    // assert
    const shout = map.sources.findIndex((source) =>
      source.endsWith("shout.ts"),
    );
    expect([...ran]).toEqual([[shout, new Set([2])]]);
  });

  test("a map it cannot read is none", () => {
    // act
    // assert
    expect(readSourceMap("{}")).toBeNull();
    expect(readSourceMap("not json")).toBeNull();
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
```
