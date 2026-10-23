# Panels

How a series review lays out what the reader looks at beside the code, and
the addresses that let one part of the screen follow another. The commits,
the threads, the component rail and the code are panels today; the
[roadmap](#roadmap) adds the author's captures, recordings and runs.

## Principles

Every choice below is judged against these, and they outlive any one layout.

1. **The code is home.** Reading code is the main job. Everything else is a
   glance away and brings the reader back to their place; nothing reloads,
   moves or hides the code behind their back.
2. **One focus, named once.** There is one thing in focus, the place being
   read and what was picked for it, named in one place. Panels show facets
   of it without saying again what it is.
3. **Fewer kinds of thing.** When two parts overlap, merge them rather than
   add a control to link them, and never repeat what the code already shows.
4. **Space follows attention.** A panel takes room only while it has
   something to say. Sizes change when the reader moves to another commit or
   asks, never because they picked something, so the screen holds still
   under their hand.
5. **Arrangements are cheap to change and cheap to undo.** A few layouts,
   one step to switch, the reader's edits to each kept, every change undone.
6. **Every frequent move has a key.** The mouse is for finding a move; keys
   are for making it again.

## Locations

A location is any spot in a review that a panel can show or point at. The
[address](address.md) already names the deliberate ones, down to a file's
line; a location covers the transient ones too, such as the component under
the reading line, and grows a kind for each new thing a panel can show.

Each kind carries the commit it belongs to, and every id in it is one the
[component map](components.md#the-component-map) keeps across versions. So a
location read at one version can be looked up again at the next, and a
panel that cannot find it says the thing is gone rather than going blank.

```ts
//| id: frontend-model-location
//| file: src/frontend/model/location.ts
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
```

### Resolving one kind into another

Most of what looks like panels keeping in step is translation: given where
the reader is, what should another panel show? The component is the hub
every kind maps through, since the map already ties each component to its
lines and will tie it to the captures that show it and the steps that run
it. Each kind therefore needs only a way to and from a component, not a way
to every other kind.

The links are many to many, so resolving answers a ranked list: a panel
shows the first and can offer the rest. A code line inside two components'
places, one nested in the other, answers the narrower first.

```ts
//| id: frontend-model-location

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
```

## The focus

The focus is where the reader is, held above the views so that any panel
can follow it. The components view moves it as the reading line passes each
heading; a panel added later reads it to pick what to show, and never writes
it back, so two panels can never chase each other. The deliberate moves, a
commit picked or a line linked, stay in the [address](address.md), where a
reload and a shared link find them; the focus is only what scrolling
changes, which would fill the browser's history if it went there too.

```ts
//| id: frontend-state-focus
//| file: src/frontend/state/focus.ts
import { useCallback, useState } from "react";
import { type Location, sameLocation } from "../model/location";

export interface Focus {
  /** What the reading line is over, or null above the first heading. */
  reading: Location | null;
  onRead: (next: Location | null) => void;
}

export function useFocus(): Focus {
  const [reading, setReading] = useState<Location | null>(null);
  // The reading line reports on every frame of a scroll; only a change
  // draws anything again.
  const onRead = useCallback(
    (next: Location | null) =>
      setReading((now) => (sameLocation(now, next) ? now : next)),
    [],
  );
  return { reading, onRead };
}
```

## Roadmap

What is still to build, in order. Each step is a pull request that moves its
part of this list into the sections above.

**Panels shell.** The review screen becomes a tree of splits with tabbed
panels at its leaves: Code, Commits, Threads and Components to start. The
default layout lies the way the screen does today, the commits and threads
over the rail and the code. A few named layouts sit in tabs, each keeping
the reader's edits, with undo and reset; the layouts live on the server.
Panels are drawn once and moved between leaves, so the code never reloads.
A panel with nothing to show for the commit folds to its tab bar; `z` zooms
the focused panel and a held `z` peeks.

**Drawing on the code.** Panels mark lines through the code's layer
(`StackLayer` and `LineDecor`) rather than `<style>` rules, so a new panel
can light the lines it cares about.

**Evidence.** Captures, recordings and runs join the component map as a
list keyed by kind with a schema version, stored in the data directory
beside the review stores, served with byte ranges so video can seek. A kind
diffy does not know falls back to a panel showing the raw file.

**Recording, for agents.** An agent records evidence; nothing else does yet.
It needs:

- MCP tools `attach_capture` (an image or clip by path on the same machine,
  with the boxes and time spans that show each component) and `attach_run`
  (a run's steps), which copy the files into the data directory, and
  `read_evidence` to see what a version has.
- A recorder it can drive, as a skill: a Playwright script whose steps each
  take a screenshot and record the page's requests, console and the lines
  of the repository they ran, from V8 block coverage and CSS rule use,
  mapped back to source paths through source maps when the app is bundled.
- The same script run at the commit and at its parent, each served from its
  own jj workspace, so every step can be compared before and after.
- Boxes found from selectors, so an agent names the element a component
  draws rather than measuring pixels.

**Viewer.** Images first, compared before and after by side, swipe, fade or
difference, with boxes that link to their components; then video, with
time as a location and spans of a clip as places. A filmstrip under the
shot picks among every capture and step of the commit.

**Runs.** Steps join the filmstrip; Network and Console show what the step
in focus did, its requests answered before and after; the lines it ran are
lit in the code. The focus gains a hold, so the reader can keep a shot while
reading on.

**Comments on any location.** A box on a capture, a moment of a clip, a step
or a request can hold a thread, which needs an anchor in the review store
wider than a line.

## Tests

```ts
//| id: frontend-model-location-test
//| file: src/frontend/model/location.test.ts
import { describe, expect, test } from "bun:test";
import type { Component, ComponentPlace } from "./components";
import { codeAt, componentsAt, type Location, sameLocation } from "./location";

function component(
  id: string,
  places: Partial<ComponentPlace>[],
  commitId = "c1",
): Component {
  return {
    commitId,
    id,
    kind: "command",
    name: id,
    role: "implements",
    gist: "",
    words: [],
    mentions: [],
    places: places.map((place) => ({
      path: "a.ts",
      side: "after",
      start: 1,
      about: "",
      ...place,
    })),
  };
}

const line = (at: number, path = "a.ts"): Location => ({
  kind: "code",
  commit: "c1",
  path,
  side: "after",
  line: at,
});

describe("locations", () => {
  test("a line nested in two components is in the narrower first", () => {
    // arrange
    const outer = component("outer", [{ start: 1, end: 20 }]);
    const inner = component("inner", [{ start: 5, end: 8 }]);

    // act
    const found = componentsAt(line(6), [outer, inner]);

    // assert
    expect(found.map((each) => each.id)).toEqual(["inner", "outer"]);
  });

  test("a line on the other side or in another commit is in nothing", () => {
    // arrange
    const before = component("a", [{ side: "before", start: 1, end: 9 }]);
    const elsewhere = component("b", [{ start: 1, end: 9 }], "c2");

    // act
    const found = componentsAt(line(3), [before, elsewhere]);

    // assert
    expect(found).toEqual([]);
  });

  test("a component's code starts with the file being read", () => {
    // arrange
    const split = component("a", [
      { path: "a.ts", start: 4 },
      { path: "b.ts", start: 10 },
    ]);
    const reading: Location = {
      kind: "component",
      commit: "c1",
      component: "a",
      path: "b.ts",
    };

    // act
    const lines = codeAt(reading, [split]);

    // assert
    expect(lines.map((each) => `${each.path}:${each.line}`)).toEqual([
      "b.ts:10",
      "a.ts:4",
    ]);
  });

  test("locations of different kinds are never the same", () => {
    // arrange
    const reading: Location = {
      kind: "component",
      commit: "c1",
      component: "a",
      path: "a.ts",
    };

    // act
    const same = sameLocation(reading, line(1));

    // assert
    expect(same).toBe(false);
  });
});
```
