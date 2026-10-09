// ~/~ begin <<docs/architecture/frontend/components.md#frontend-model-components>>[init]
import * as z from "zod";

/** Lines of one file a commit changes, counted from 1 on `side`, both ends
 *  included. */
export const ComponentPlace = z.object({
  path: z.string(),
  side: z.enum(["before", "after"]).default("after"),
  start: z.number().int().positive(),
  end: z.number().int().positive().optional(),
  /** What this place does for its component, in a few words. */
  about: z.string().default(""),
  /** The place of the same component that this one moves code to or from. */
  moves: z.number().int().nonnegative().optional(),
});
export type ComponentPlace = z.infer<typeof ComponentPlace>;

/** What a component does for its commit, which the rail groups by. */
export const ComponentRole = z.enum([
  "implements",
  "refactors",
  "wires",
  "tests",
]);
export type ComponentRole = z.infer<typeof ComponentRole>;

/** One piece of work a commit does, named for what it is. */
export const Component = z.object({
  commitId: z.string(),
  /** The same in every version, so each version's map names the same
   *  component the same way. */
  id: z.string().min(1),
  /** What it is: schema, command, view, wiring, test. */
  kind: z.string().min(1),
  name: z.string().min(1),
  role: ComponentRole,
  /** What it does, in a sentence. */
  gist: z.string().default(""),
  /** Names in the code that mean this component. */
  words: z.array(z.string()).default([]),
  /** Phrases in the commit's message that describe it. */
  mentions: z.array(z.string()).default([]),
  /** In reading order. */
  places: z.array(ComponentPlace).min(1),
});
export type Component = z.infer<typeof Component>;

/** What each commit of one version of a series builds, component by
 *  component. */
export const ComponentMap = z.object({
  series: z.string(),
  version: z.string(),
  author: z.string(),
  writtenAt: z.string(),
  components: z.array(Component),
});
export type ComponentMap = z.infer<typeof ComponentMap>;

/** The map of one version of a series, if one was written. */
export function componentsTo(
  maps: ComponentMap[],
  series: string,
  version: string,
): ComponentMap | undefined {
  return maps.find((map) => map.series === series && map.version === version);
}

/** `maps` with `map` in place of any map of the same version. */
export function withComponents(
  maps: ComponentMap[],
  map: ComponentMap,
): ComponentMap[] {
  return [
    ...maps.filter(
      (kept) => kept.series !== map.series || kept.version !== map.version,
    ),
    map,
  ];
}
// ~/~ end
