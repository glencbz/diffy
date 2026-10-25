// ~/~ begin <<docs/architecture/backend/runs.md#backend-evidence-play-run>>[init]
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
// ~/~ end
