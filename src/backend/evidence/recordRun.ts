// ~/~ begin <<docs/architecture/backend/runs.md#backend-evidence-recorder-run>>[init]
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
// ~/~ end
