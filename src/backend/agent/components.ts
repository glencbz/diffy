// ~/~ begin <<docs/architecture/backend/agents.md#backend-agent-components>>[init]
import * as z from "zod";
import {
  type Component,
  type ComponentGroup,
  ComponentKind,
  type ComponentMap,
  ComponentPlace,
  ComponentRole,
  coloursOf,
  componentsTo,
  KindColour,
} from "../../frontend/model/components";
import { readPatch } from "../../frontend/model/patch";
import type { JjFileDiff } from "../commit/jj";
import type { RepoContext } from "../repo/repos";
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
      "what it is, in a word of the repository's vocabulary, which read_component_kinds lists with how to tell each",
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
      "the runs of changed lines that make it, in reading order: a path, lines start to end on side (after unless the lines were removed), what the place does in a few words, and, for code that moved, moves: the index of this component's place at the other end, on the other side",
    ),
});
type ComponentInput = z.infer<typeof ComponentInput>;

const GroupInput = z.object({
  commit: z
    .string()
    .min(1)
    .describe("the change id or commit id the group's components belong to"),
  id: z
    .string()
    .min(1)
    .describe("a short slug for the group, the same in every version"),
  name: z
    .string()
    .min(1)
    .describe("what the group is, in a few words, such as Stored replies"),
  gist: z.string().default("").describe("what the group does, in a sentence"),
  components: z
    .array(z.string().min(1))
    .min(1)
    .describe("the ids of this commit's components that make it"),
});

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
    // One end of a move removes the code and the other adds it, which is how
    // the reader is told which way it went.
    if (
      place.moves !== undefined &&
      input.places[place.moves]?.side === place.side
    ) {
      return `place ${index} of ${input.id} moves to place ${place.moves} on the same side; a move goes from removed lines to added ones`;
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

/** The vocabulary, a kind to a line with its colour and how to tell it. */
function vocabulary(kinds: ComponentKind[]): string {
  if (kinds.length === 0) {
    return "this repository has no vocabulary, so a component can be of any kind";
  }
  const colours = coloursOf(kinds);
  return kinds
    .map(
      (kind) =>
        `${kind.name} (${colours.get(kind.name)})${kind.advice === "" ? "" : `: ${kind.advice}`}`,
    )
    .join("\n");
}

export function componentTools(
  sourcesOf: (repo: RepoContext) => SeriesSources = liveSources,
): Tool[] {
  return [
    tool({
      name: "write_components",
      description:
        "Write the component map of the newest version of a local review or a pull request, replacing any map of that version: for each commit, the components it builds, each of a kind from the repository's vocabulary (read_component_kinds), and the changed lines that make each one, and the groups those components form. Keep a component's id from version to version, so the reader is told what is new, gone or changed. Answers with the reader's link and the changed lines no component claims.",
      input: z.object({
        ...Target,
        components: z.array(ComponentInput).min(1),
        groups: z
          .array(GroupInput)
          .default([])
          .describe(
            "each commit's components grouped into the parts of the change a reader would check one at a time, such as the stored data, the command that changes it and the view that draws it; a component is in one group at most",
          ),
      }),
      call: async (
        { review, pull, components, groups },
        { repo, link, now },
      ) => {
        const { store } = repo;
        const sources = sourcesOf(repo);
        const kinds = store.read().document.componentKinds;
        const unknown = components.find(
          (input) =>
            kinds.length > 0 && !kinds.some((kind) => kind.name === input.kind),
        );
        if (unknown !== undefined) {
          throw new ToolError(
            `${unknown.id} is a ${unknown.kind}, which is not a kind this repository uses. Its kinds are:\n${vocabulary(kinds)}`,
          );
        }
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

        const placed = new Set<string>();
        const named = new Set<string>();
        const grouped = groups.map(({ commit, ...rest }): ComponentGroup => {
          const commitId = commitNamed(target, commit).commitId;
          const label = short(commitNamed(target, commit));
          if (named.has(`${commitId}:${rest.id}`)) {
            throw new ToolError(`${label} has two groups named ${rest.id}`);
          }
          named.add(`${commitId}:${rest.id}`);
          for (const id of rest.components) {
            if (
              !resolved.some(
                (component) =>
                  component.commitId === commitId && component.id === id,
              )
            ) {
              throw new ToolError(
                `group ${rest.id} names ${id}, which is not a component of ${label}`,
              );
            }
            if (placed.has(`${commitId}:${id}`)) {
              throw new ToolError(
                `${id} is in two groups of ${label}; a component is in one group at most`,
              );
            }
            placed.add(`${commitId}:${id}`);
          }
          return { ...rest, commitId };
        });

        const map: ComponentMap = {
          series: target.series,
          version: target.version,
          author: AGENT,
          writtenAt: now().toISOString(),
          components: resolved,
          groups: grouped,
        };
        store.apply({ kind: "write-components", map });
        return [
          link(target.path),
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
      call: async ({ review, pull, version }, { repo }) => {
        const { store } = repo;
        const target = await targetOf(sourcesOf(repo), { review, pull });
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
            groups: map.groups.map(({ commitId, ...group }) => ({
              commit: names.get(commitId) ?? commitId,
              ...group,
            })),
          },
          null,
          2,
        );
      },
    }),
    tool({
      name: "read_component_kinds",
      description:
        "Read this repository's vocabulary of component kinds, each with advice on how to tell a component of that kind. Read it before writing a component map, and use only these kinds.",
      input: z.object({}),
      call: async (_input, { repo: { store } }) =>
        vocabulary(store.read().document.componentKinds),
    }),
    tool({
      name: "define_component_kind",
      description:
        "Add a kind to this repository's vocabulary of component kinds, or change the advice, colour or place of one it has. The reader decides the vocabulary: define a kind when they ask for one. A new kind needs a colour: take the one the reader names, or else one no other kind is drawn in, and tell the reader which. Answers with the whole vocabulary and each kind's colour.",
      input: z.object({
        name: ComponentKind.shape.name.describe(
          "the kind, one lowercase word, such as controller",
        ),
        advice: z
          .string()
          .min(1)
          .optional()
          .describe(
            "how to tell a component of this kind from the others, written to the agent that will map a change; a new kind needs it, and leaving it out keeps a kind's advice",
          ),
        colour: KindColour.optional().describe(
          "the colour it is drawn in; a new kind needs one, and leaving it out keeps a kind's colour",
        ),
        before: z
          .string()
          .optional()
          .describe(
            "the kind to place it just before; without one a new kind goes last and a kind already there stays where it is",
          ),
      }),
      call: async ({ name, advice, colour, before }, { repo: { store } }) => {
        const kinds = store.read().document.componentKinds;
        const kept = kinds.find((kind) => kind.name === name);
        const told = advice ?? kept?.advice;
        const drawn = colour ?? kept?.colour;
        if (kept === undefined && (told === undefined || drawn === undefined)) {
          throw new ToolError(
            `${name} is a new kind, so it needs advice and a colour. The colours taken are:\n${vocabulary(kinds)}`,
          );
        }
        if (
          before !== undefined &&
          !kinds.some((kind) => kind.name === before)
        ) {
          throw new ToolError(
            `${before} is not a kind this repository uses. Its kinds are:\n${vocabulary(kinds)}`,
          );
        }
        const { document } = store.apply({
          kind: "define-kind",
          name,
          advice: told ?? "",
          ...(drawn === undefined ? {} : { colour: drawn }),
          before,
        });
        return vocabulary(document.componentKinds);
      },
    }),
    tool({
      name: "remove_component_kind",
      description:
        "Remove a kind from this repository's vocabulary of component kinds, when the reader asks. Maps already written keep it, drawn grey. Answers with the whole vocabulary.",
      input: z.object({ name: z.string().min(1) }),
      call: async ({ name }, { repo: { store } }) => {
        const kinds = store.read().document.componentKinds;
        if (!kinds.some((kind) => kind.name === name)) {
          throw new ToolError(
            `${name} is not a kind this repository uses. Its kinds are:\n${vocabulary(kinds)}`,
          );
        }
        const { document } = store.apply({ kind: "remove-kind", name });
        return vocabulary(document.componentKinds);
      },
    }),
  ];
}
// ~/~ end
