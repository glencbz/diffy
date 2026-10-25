// ~/~ begin <<docs/architecture/frontend/panels.md#frontend-model-location>>[init]
import type { Component } from "./components";

/** A spot in a review that a panel can show or point at. */
export type Location = CodeLocation | ComponentLocation;

/** A line of a file, on one side of a commit's diff. */
export interface CodeLocation {
  kind: "code";
  commit: string;
  path: string;
  side: "before" | "after";
  line: number;
}

/** A component, and the file it is being read in when it spans several. */
export interface ComponentLocation {
  kind: "component";
  commit: string;
  component: string;
  path: string | null;
}

export type LocationKind = Location["kind"];

/** A place a panel asked the code to go, numbered so the same place asked
 *  twice still moves it. */
export interface Asked {
  location: Location;
  at: number;
}

export function sameLocation(a: Location | null, b: Location | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind === "code" && b.kind === "code") {
    return (
      a.commit === b.commit &&
      a.path === b.path &&
      a.side === b.side &&
      a.line === b.line
    );
  }
  if (a.kind === "component" && b.kind === "component") {
    return (
      a.commit === b.commit && a.component === b.component && a.path === b.path
    );
  }
  return false;
}
// ~/~ end
// ~/~ begin <<docs/architecture/frontend/panels.md#frontend-model-location>>[1]

/** The components a location is in, the most specific first. */
export function componentsAt(
  location: Location,
  components: Component[],
): Component[] {
  if (location.kind === "component") {
    return components.filter(
      (each) =>
        each.id === location.component && each.commitId === location.commit,
    );
  }
  const covering = components.flatMap((component) => {
    if (component.commitId !== location.commit) return [];
    const spans = component.places
      .filter(
        (place) =>
          place.path === location.path &&
          place.side === location.side &&
          place.start <= location.line &&
          (place.end ?? place.start) >= location.line,
      )
      .map((place) => (place.end ?? place.start) - place.start);
    return spans.length === 0 ? [] : [{ component, span: Math.min(...spans) }];
  });
  return covering.sort((a, b) => a.span - b.span).map((each) => each.component);
}

/** Where a location's code is: its own line, or the first line of each of
 *  a component's places, in the map's order, the file being read first. */
export function codeAt(
  location: Location,
  components: Component[],
): CodeLocation[] {
  if (location.kind === "code") return [location];
  const component = componentsAt(location, components)[0];
  if (component === undefined) return [];
  const lines = component.places.map(
    (place): CodeLocation => ({
      kind: "code",
      commit: component.commitId,
      path: place.path,
      side: place.side,
      line: place.start,
    }),
  );
  return [
    ...lines.filter((line) => line.path === location.path),
    ...lines.filter((line) => line.path !== location.path),
  ];
}
// ~/~ end
