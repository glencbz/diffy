// ~/~ begin <<docs/architecture/backend/evidence.md#backend-agent-evidence>>[init]
import * as z from "zod";
import { componentsTo } from "../../frontend/model/components";
import {
  type Box,
  type Capture,
  capturesOf,
  type Shown,
} from "../../frontend/model/evidence";
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

const ShownInput = z.object({
  component: z
    .string()
    .min(1)
    .describe("the id of a component of the commit's map"),
  box: z
    .object({
      x: z.number(),
      y: z.number(),
      width: z.number().positive(),
      height: z.number().positive(),
    })
    .optional()
    .describe(
      "where on the capture the component draws, in the page's pixels, as a browser driver measures an element",
    ),
  at: z
    .object({ start: z.number().min(0), end: z.number().min(0) })
    .optional()
    .describe("for a clip, the seconds in which it shows the component"),
  about: z
    .string()
    .default("")
    .describe("what to look for there, in a few words"),
});

/** Why a box cannot be drawn on a page of `size`, or its fractions. */
function boxOf(
  box: { x: number; y: number; width: number; height: number },
  size: { width: number; height: number },
  component: string,
): Box {
  const slack = 1;
  if (
    box.x < -slack ||
    box.y < -slack ||
    box.x + box.width > size.width + slack ||
    box.y + box.height > size.height + slack
  ) {
    throw new ToolError(
      `${component}'s box reaches off a ${size.width}×${size.height} page; measure boxes in the page's own pixels and give the size they were measured in`,
    );
  }
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  return [
    clamp(box.x / size.width),
    clamp(box.y / size.height),
    clamp(box.width / size.width),
    clamp(box.height / size.height),
  ];
}

export function evidenceTools(
  store: EvidenceStore,
  sourcesOf: (repo: RepoContext) => SeriesSources = liveSources,
): Tool[] {
  return [
    tool({
      name: "attach_capture",
      description:
        "Attach a screenshot or a clip of the app to a commit of the newest version of a local review or a pull request: the app at the commit, and at its parent where it can be shown, with where it shows each of the commit's components. Write the version's component map first; a capture names its components by their ids. Attaching an id the commit already has replaces it.",
      input: z.object({
        ...Target,
        commit: z
          .string()
          .min(1)
          .describe("the change id or commit id it shows, or a prefix"),
        id: z
          .string()
          .min(1)
          .describe(
            "a short slug, the same in every version that captures the same thing",
          ),
        name: z
          .string()
          .min(1)
          .describe("what it shows, such as the page's name: Settings"),
        state: z
          .array(z.string())
          .default([])
          .describe(
            "the state of the app, a word or two each, such as dark or phone",
          ),
        about: z.string().default("").describe("what to look for, a sentence"),
        after: z
          .string()
          .min(1)
          .optional()
          .describe(
            "the path on this machine of the picture or clip taken at the commit",
          ),
        before: z
          .string()
          .min(1)
          .optional()
          .describe(
            "the path of the same taken at the commit's parent, if it can be shown there",
          ),
        size: z
          .object({
            width: z.number().positive(),
            height: z.number().positive(),
          })
          .describe("the page's size in the pixels the boxes are measured in"),
        shows: z.array(ShownInput).default([]),
      }),
      call: async (input, { repo, link, now }) => {
        if (input.after === undefined && input.before === undefined) {
          throw new ToolError(
            "give the capture at the commit, its parent, or both",
          );
        }
        const target = await targetOf(sourcesOf(repo), input);
        const commit = commitNamed(target, input.commit);
        const map = componentsTo(
          repo.store.read().document.componentMaps,
          target.series,
          target.version,
        );
        const ids = (map?.components ?? [])
          .filter((each) => each.commitId === commit.commitId)
          .map((each) => each.id);
        const stray = input.shows.find((each) => !ids.includes(each.component));
        if (stray !== undefined) {
          throw new ToolError(
            ids.length === 0
              ? `${short(commit)} has no components in ${target.label}'s map; write the map first`
              : `${stray.component} is not a component of ${short(commit)}; its components are ${ids.join(", ")}`,
          );
        }
        const shows = input.shows.map(
          (each): Shown => ({
            component: each.component,
            about: each.about,
            ...(each.box === undefined
              ? {}
              : { box: boxOf(each.box, input.size, each.component) }),
            ...(each.at === undefined
              ? {}
              : { at: [each.at.start, Math.max(each.at.start, each.at.end)] }),
          }),
        );
        const stored = async (path: string | undefined) => {
          if (path === undefined) return null;
          const put = await store.put(path);
          if ("refused" in put) throw new ToolError(put.refused);
          return put.name;
        };
        const before = await stored(input.before);
        const after = await stored(input.after);
        const video = [before, after].some(
          (name) => name !== null && /\.(mp4|webm)$/.test(name),
        );
        const capture: Capture = {
          series: target.series,
          version: target.version,
          commitId: commit.commitId,
          id: input.id,
          name: input.name,
          state: input.state,
          about: input.about,
          media: video ? "video" : "image",
          before,
          after,
          shows,
          attachedAt: now().toISOString(),
        };
        repo.store.apply({ kind: "attach-capture", capture });
        return [
          link(target.path),
          `${input.id} is attached to ${short(commit)} in ${target.label}, showing ${shows.length === 0 ? "no component" : shows.map((each) => each.component).join(", ")}`,
        ].join("\n");
      },
    }),
    tool({
      name: "read_captures",
      description:
        "Read the captures attached to the newest version of a local review or a pull request, as JSON, with what each shows.",
      input: z.object({ ...Target }),
      call: async (input, { repo }) => {
        const target = await targetOf(sourcesOf(repo), input);
        const names = new Map(
          target.commits.map((commit) => [commit.commitId, short(commit)]),
        );
        const captures = capturesOf(
          repo.store.read().document.captures,
          target.series,
          target.version,
        );
        if (captures.length === 0) return `${target.label} has no captures yet`;
        return JSON.stringify(
          captures.map(({ series, version, commitId, ...rest }) => ({
            commit: names.get(commitId) ?? commitId,
            ...rest,
          })),
          null,
          2,
        );
      },
    }),
    tool({
      name: "detach_capture",
      description:
        "Take a capture off a commit of the newest version of a local review or a pull request.",
      input: z.object({
        ...Target,
        commit: z
          .string()
          .min(1)
          .describe("the change id or commit id, or a prefix"),
        id: z.string().min(1).describe("the capture's id"),
      }),
      call: async (input, { repo }) => {
        const target = await targetOf(sourcesOf(repo), input);
        const commit = commitNamed(target, input.commit);
        const had = capturesOf(
          repo.store.read().document.captures,
          target.series,
          target.version,
        ).some(
          (each) => each.commitId === commit.commitId && each.id === input.id,
        );
        if (!had) {
          throw new ToolError(`${short(commit)} has no capture ${input.id}`);
        }
        repo.store.apply({
          kind: "detach-capture",
          series: target.series,
          version: target.version,
          commitId: commit.commitId,
          id: input.id,
        });
        return `${input.id} is off ${short(commit)}`;
      },
    }),
  ];
}
// ~/~ end
