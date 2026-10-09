// ~/~ begin <<docs/architecture/backend/agents.md#backend-agent-components>>[init]
import * as z from "zod";
import {
  type Component,
  type ComponentMap,
  ComponentPlace,
  ComponentRole,
  componentsTo,
} from "../../frontend/model/components";
import { readPatch } from "../../frontend/model/patch";
import type { JjFileDiff } from "../commit/jj";
import type { ReviewStore } from "../review/store";
import { type Tool, ToolError, tool } from "./mcp";
import { AGENT } from "./review";
import {
  commitNamed,
  liveSources,
  pathsOf,
  type SeriesSources,
  short,
  Target,
  targetOf,
} from "./series";

const ComponentInput = z.object({
  commit: z
    .string()
    .min(1)
    .describe(
      "the change id or commit id the component belongs to, or a prefix",
    ),
  id: z
    .string()
    .min(1)
    .describe(
      "a short slug for the component, the same in every version that has it, so versions can be compared",
    ),
  kind: z
    .string()
    .min(1)
    .describe(
      "what it is, in a word: schema, command, action, view, styles, wiring, test",
    ),
  name: z
    .string()
    .min(1)
    .describe("its name, usually the identifier it is known by"),
  role: ComponentRole.describe(
    "what it does for the commit: implements, refactors, wires (passes things along) or tests",
  ),
  gist: z.string().default("").describe("what it does, in a sentence"),
  words: z
    .array(z.string())
    .default([])
    .describe("names in the code that mean this component, which link to it"),
  mentions: z
    .array(z.string())
    .default([])
    .describe(
      "phrases quoted exactly from the commit's message that describe this component, which link to it",
    ),
  places: z
    .array(ComponentPlace)
    .min(1)
    .describe(
      "the runs of changed lines that make it, in reading order: a path, lines start to end on side (after unless the lines were removed), what the place does in a few words, and moves for the index of the place of this component that it moves code to or from",
    ),
});
type ComponentInput = z.infer<typeof ComponentInput>;

/** A file's changed lines on each side. */
function changedLines(file: JjFileDiff) {
  const before: number[] = [];
  const after: number[] = [];
  for (const hunk of readPatch(file.patch).hunks) {
    for (const line of hunk.lines) {
      if (line.kind === "added") after.push(line.newLine);
      if (line.kind === "removed") before.push(line.oldLine);
    }
  }
  return { before, after };
}

/** `lines` as `first-last` runs, at most `SHOWN` of them. */
const SHOWN = 4;
function runs(lines: number[]): string {
  const out: [number, number][] = [];
  for (const line of lines) {
    const last = out.at(-1);
    if (last !== undefined && last[1] === line - 1) last[1] = line;
    else out.push([line, line]);
  }
  const shown = out
    .slice(0, SHOWN)
    .map(([first, last]) => (first === last ? `${first}` : `${first}-${last}`));
  const more = out.length - SHOWN;
  return `${shown.join(", ")}${more > 0 ? ` and ${more} more` : ""}`;
}

const spaced = (text: string) => text.replace(/\s+/g, " ");

/** Why `input` cannot be drawn on its commit, or null. */
function refusal(
  input: ComponentInput,
  files: JjFileDiff[],
  message: string,
): string | null {
  const paths = new Set(files.flatMap(pathsOf));
  for (const [index, place] of input.places.entries()) {
    if (!paths.has(place.path)) {
      return `${input.id}'s commit does not change ${place.path}`;
    }
    if (place.end !== undefined && place.end < place.start) {
      return `place ${index} of ${input.id} ends at ${place.end}, before it starts`;
    }
    if (
      place.moves !== undefined &&
      (place.moves === index || place.moves >= input.places.length)
    ) {
      return `place ${index} of ${input.id} moves to place ${place.moves}, which is not another of its places`;
    }
  }
  const quoted = spaced(message);
  const missing = input.mentions.find(
    (phrase) => !quoted.includes(spaced(phrase)),
  );
  if (missing !== undefined) {
    return `the message of ${input.id}'s commit does not say "${missing}"`;
  }
  return null;
}

/** The changed lines of `files` no place of `components` covers, one line
 *  per file. */
function unclaimed(files: JjFileDiff[], components: Component[]): string[] {
  return files.flatMap((file) => {
    const paths = pathsOf(file);
    const places = components.flatMap((each) =>
      each.places.filter((place) => paths.includes(place.path)),
    );
    const covered = (side: "before" | "after", line: number) =>
      places.some(
        (place) =>
          place.side === side &&
          line >= place.start &&
          line <= (place.end ?? place.start),
      );
    const { before, after } = changedLines(file);
    const added = after.filter((line) => !covered("after", line));
    const removed = before.filter((line) => !covered("before", line));
    if (added.length === 0 && removed.length === 0) return [];
    return [
      `${paths.at(-1) ?? ""}:${added.length > 0 ? ` added ${runs(added)}` : ""}${removed.length > 0 ? ` removed ${runs(removed)}` : ""}`,
    ];
  });
}

export function componentTools(
  store: ReviewStore,
  sources: SeriesSources = liveSources(store),
): Tool[] {
  return [
    tool({
      name: "write_components",
      description:
        "Write the component map of the newest version of a local review or a pull request, replacing any map of that version: for each commit, the components it builds (a schema, a command, a view, the wiring between them) and the changed lines that make each one. Keep a component's id from version to version, so the reader is told what is new, gone or changed. Answers with the reader's link and the changed lines no component claims.",
      input: z.object({
        ...Target,
        components: z.array(ComponentInput).min(1),
      }),
      call: async ({ review, pull, components }, { origin }) => {
        const target = await targetOf(sources, { review, pull });
        const resolved = components.map(
          ({ commit, ...rest }): Component => ({
            ...rest,
            commitId: commitNamed(target, commit).commitId,
          }),
        );

        const missed: string[] = [];
        for (const commit of target.commits) {
          const own = resolved.filter(
            (component) => component.commitId === commit.commitId,
          );
          if (own.length === 0) {
            missed.push(`${short(commit)} has no components`);
            continue;
          }
          const ids = own.map((component) => component.id);
          const twice = ids.find((id, index) => ids.indexOf(id) !== index);
          if (twice !== undefined) {
            throw new ToolError(
              `${short(commit)} has two components named ${twice}`,
            );
          }
          const files = await sources.diff(commit.commitId);
          for (const input of components) {
            if (
              commitNamed(target, input.commit).commitId !== commit.commitId
            ) {
              continue;
            }
            const why = refusal(input, files, commit.description);
            if (why !== null) throw new ToolError(why);
          }
          for (const line of unclaimed(files, own)) {
            missed.push(`${short(commit)} ${line}`);
          }
        }

        const map: ComponentMap = {
          series: target.series,
          version: target.version,
          author: AGENT,
          writtenAt: new Date().toISOString(),
          components: resolved,
        };
        store.apply({ kind: "write-components", map });
        return [
          `${origin}${target.path}`,
          `the components of ${target.label}: ${resolved.length} over ${new Set(resolved.map((component) => component.commitId)).size} of ${target.commits.length} commits`,
          ...(missed.length === 0
            ? ["every changed line belongs to a component"]
            : ["no component claims:", ...missed.map((line) => `  ${line}`)]),
        ].join("\n");
      },
    }),
    tool({
      name: "read_components",
      description:
        "Read the component map of the newest version of a local review or a pull request as JSON, in the shape write_components takes, so it can be edited and written back. Read the previous version's map before writing a new one, to keep its ids.",
      input: z.object({
        ...Target,
        version: z
          .string()
          .optional()
          .describe("an older version to read instead, such as v1"),
      }),
      call: async ({ review, pull, version }) => {
        const target = await targetOf(sources, { review, pull });
        const asked =
          version === undefined
            ? target.version
            : review !== undefined
              ? version.replace(/^v/, "")
              : null;
        if (asked === null) {
          throw new ToolError(
            "an older version of a pull request is read by its newest only",
          );
        }
        const map = componentsTo(
          store.read().document.componentMaps,
          target.series,
          asked,
        );
        if (map === undefined) {
          return `${version ?? target.label} has no component map yet`;
        }
        const names = new Map(
          target.commits.map((commit) => [commit.commitId, short(commit)]),
        );
        return JSON.stringify(
          {
            components: map.components.map(({ commitId, ...component }) => ({
              commit: names.get(commitId) ?? commitId,
              ...component,
            })),
          },
          null,
          2,
        );
      },
    }),
  ];
}
// ~/~ end
