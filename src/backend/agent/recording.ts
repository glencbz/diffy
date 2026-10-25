// ~/~ begin <<docs/architecture/backend/recording.md#backend-agent-recording>>[init]
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
// ~/~ end
