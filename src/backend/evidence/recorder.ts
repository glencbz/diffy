// ~/~ begin <<docs/architecture/backend/recording.md#backend-evidence-recorder>>[init]
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
// ~/~ end
