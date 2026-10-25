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
// ~/~ end
