// ~/~ begin <<docs/architecture/frontend/components.md#frontend-model-groups>>[init]
import type { Component, ComponentGroup, ComponentRole } from "./components";

/** A way of grouping a commit's components. */
export type Arrangement = "piece" | "layer" | "role";

/** One group of an arrangement, its components in the map's order. */
export interface Group {
  id: string;
  name: string;
  /** What the group is, in a sentence. */
  gist: string;
  ids: string[];
}

/** The arrangements a commit offers: by piece only once the agent has
 *  named some. */
export function arrangementsOf(groups: ComponentGroup[]): Arrangement[] {
  return groups.length > 0 ? ["piece", "layer", "role"] : ["layer", "role"];
}

const ROLES: [ComponentRole, string, string][] = [
  ["implements", "implements", "Components that build what the commit is for."],
  [
    "refactors",
    "refactors",
    "Components that reshape code without changing what it does.",
  ],
  ["wires", "wires through", "Components that only pass things along."],
  ["tests", "tests", "Tests and their fixtures."],
];

/** Test files by the names test runners look for. */
const TEST = /(^|\/)(tests?|__tests__|spec)\/|[._-](test|spec)\.[^/]+$/;

const dirsOf = (path: string) => path.split("/").slice(0, -1);
const linesOf = (place: { start: number; end?: number }) =>
  (place.end ?? place.start) - place.start + 1;

/** The folders of `components`, one level under the folder all their
 *  non-test files share, and test files as one more. */
function byLayer(components: Component[]): Group[] {
  const dirs = components
    .flatMap((each) => each.places.map((place) => place.path))
    .filter((path) => !TEST.test(path))
    .map(dirsOf);
  const first = dirs[0] ?? [];
  let common = 0;
  while (
    common < first.length &&
    dirs.every((each) => each[common] === first[common])
  ) {
    common++;
  }
  const shared = first.slice(0, common).join("/");
  const layerOf = (path: string) =>
    TEST.test(path)
      ? "tests"
      : (dirsOf(path)[common] ?? (shared === "" ? "(top)" : shared));
  const home = (component: Component) => {
    const lines = new Map<string, number>();
    for (const place of component.places) {
      const layer = layerOf(place.path);
      lines.set(layer, (lines.get(layer) ?? 0) + linesOf(place));
    }
    return [...lines].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "(top)";
  };
  const groups = new Map<string, string[]>();
  for (const component of components) {
    const layer = home(component);
    groups.set(layer, [...(groups.get(layer) ?? []), component.id]);
  }
  const prefix = shared === "" ? "" : `${shared}/`;
  return [...groups]
    .sort(([a], [b]) =>
      a === "tests" ? 1 : b === "tests" ? -1 : a.localeCompare(b),
    )
    .map(([name, ids]) => ({
      id: name,
      name,
      gist:
        name === "tests"
          ? "Components whose lines are mostly in test files."
          : `Components whose lines are mostly under ${prefix}${name === shared ? "" : `${name}/`}.`,
      ids,
    }));
}

/** `components` arranged into groups, each group holding at least one.
 *  `groups` are the agent's, used by piece. */
export function arrange(
  arrangement: Arrangement,
  components: Component[],
  groups: ComponentGroup[],
): Group[] {
  const ids = (keep: (component: Component) => boolean) =>
    components.filter(keep).map((component) => component.id);
  const arranged: Group[] =
    arrangement === "piece"
      ? [
          ...groups.map((group) => ({
            id: group.id,
            name: group.name,
            gist: group.gist,
            ids: ids((component) => group.components.includes(component.id)),
          })),
          {
            id: "",
            name: "everything else",
            gist: "Components the agent put in no group.",
            ids: ids(
              (component) =>
                !groups.some((group) =>
                  group.components.includes(component.id),
                ),
            ),
          },
        ]
      : arrangement === "layer"
        ? byLayer(components)
        : ROLES.map(([role, name, gist]) => ({
            id: role,
            name,
            gist,
            ids: ids((component) => component.role === role),
          }));
  return arranged.filter((group) => group.ids.length > 0);
}

/** The groups a group's components use, and the groups using it, from
 *  which component each line of the diff names. */
export function groupLinks(
  groups: Group[],
  uses: { from: string; to: string }[],
): Map<string, { uses: Group[]; usedBy: Group[] }> {
  const home = (id: string) => groups.find((group) => group.ids.includes(id));
  const out = new Map(
    groups.map((group) => [
      group.id,
      { uses: new Set<Group>(), usedBy: new Set<Group>() },
    ]),
  );
  for (const use of uses) {
    const from = home(use.from);
    const to = home(use.to);
    if (from === undefined || to === undefined || from === to) continue;
    out.get(from.id)?.uses.add(to);
    out.get(to.id)?.usedBy.add(from);
  }
  return new Map(
    [...out].map(([id, links]) => [
      id,
      { uses: [...links.uses], usedBy: [...links.usedBy] },
    ]),
  );
}
// ~/~ end
