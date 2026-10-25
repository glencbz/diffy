// ~/~ begin <<docs/architecture/backend/runs.md#backend-agent-runs>>[init]
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
// ~/~ end
