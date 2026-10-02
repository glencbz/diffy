# Address

Where a reader is lives in the address, so a link can be shared and a reload
returns to the same place:

A pull request opened on a line reads like this, with the ids cut short here:

```
/pulls/41/commits/77d2…/files/src/server.ts?from=4c1e…&to=9a0b…#L120
```

The path is the place's hierarchy, screen down to file, and reading stops at
the first segment that does not parse, so a cut-short or mistyped link opens
as much as still makes sense. The file path comes last because it holds
slashes; the line is the fragment, as GitHub writes it. A flat query string
(`?pull=41&commit=…&file=…`) would hide that nesting. The two heads go in the
query because they are settings on the view, each with a default that is
left out (no `from` is the base, no `to` the latest head). A head the pull
request never had is not caught here; it reads as the commit list's fetch
error.

## The place

`Place`'s nesting is the path's, so a line without a file cannot be held.

```ts
//| id: frontend-model-place
//| file: src/frontend/model/place.ts
import { GitOid } from "./history";
import type { PullBaseline } from "./pull";

export type Place =
  | { tab: "local" }
  | { tab: "settings" }
  | { tab: "pulls"; pull: PullPlace | null };

export interface PullPlace {
  number: number;
  from: PullBaseline;
  /** `null` is whichever head is latest when the place is opened. Picking a
   *  commit pins it, since a commit id only means something under its head. */
  to: GitOid | null;
  spot: CommitSpot | null;
}

/** A commit picked in the graph, and what in its diff is picked. */
export interface CommitSpot {
  commit: GitOid;
  file: FileSpot | null;
}

/** A file in a diff, by its after-side path, and one of its lines. */
export interface FileSpot {
  path: string;
  /** An after-side line number, the one the gutter shows. A removed line has
   *  none, so it cannot be linked, as it cannot be commented on. */
  line: number | null;
}

export function openPull(number: number): PullPlace {
  return { number, from: { kind: "base" }, to: null, spot: null };
}

/** A screen as it opens from its tab, with nothing picked on it yet. */
export function tabPlace(tab: Place["tab"]): Place {
  return tab === "pulls" ? { tab: "pulls", pull: null } : { tab };
}
```

Reading and writing are inverses on every place the type can hold. Reading
treats the address as untrusted input.

```ts
//| id: frontend-model-place
/** The parts of a URL a place is read from. `window.location` is one. */
export type Address = Pick<URL, "pathname" | "search" | "hash">;

export function readPlace(address: Address): Place {
  const [tab, ...rest] = address.pathname.split("/").filter((s) => s !== "");
  if (tab === "settings") return { tab: "settings" };
  if (tab !== "pulls") return { tab: "local" };
  return { tab: "pulls", pull: readPull(rest, address) };
}

function readPull(
  [numberSegment, commits, commitSegment, files, ...pathSegments]: string[],
  { search, hash }: Address,
): PullPlace | null {
  const number = positive(numberSegment);
  if (number === null) return null;

  const params = new URLSearchParams(search);
  const fromParam = params.get("from");
  const fromHead = oid(fromParam);
  const from: PullBaseline =
    fromHead === null ? { kind: "base" } : { kind: "version", head: fromHead };
  const toParam = params.get("to");
  const to = oid(toParam);
  // A head that does not parse is a link to a version nobody can find, and
  // reading on past it would pin a commit under whatever head stood in.
  if (
    (fromParam !== null && fromHead === null) ||
    (toParam !== null && to === null)
  ) {
    return openPull(number);
  }

  const commit = commits === "commits" ? oid(commitSegment) : null;
  if (commit === null) return { number, from, to, spot: null };

  const path =
    files === "files" && pathSegments.length > 0
      ? decoded(pathSegments.join("/"))
      : null;
  if (path === null) return { number, from, to, spot: { commit, file: null } };

  const line = positive(/^#L(.*)$/.exec(hash)?.[1]);
  return { number, from, to, spot: { commit, file: { path, line } } };
}

function positive(value: string | null | undefined): number | null {
  if (value == null || !/^[1-9][0-9]*$/.test(value)) return null;
  return Number(value);
}

function oid(value: string | null | undefined): GitOid | null {
  const parsed = GitOid.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function decoded(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/** The path, query, and fragment for a place. */
export function writePlace(place: Place): string {
  if (place.tab === "local") return "/";
  if (place.tab === "settings") return "/settings";
  if (place.pull === null) return "/pulls";

  const { number, from, to, spot } = place.pull;
  const segments = ["pulls", String(number)];
  let hash = "";
  if (spot !== null) {
    segments.push("commits", spot.commit);
    if (spot.file !== null) {
      segments.push("files", ...spot.file.path.split("/"));
      if (spot.file.line !== null) hash = `#L${spot.file.line}`;
    }
  }

  const params = new URLSearchParams();
  if (from.kind === "version") params.set("from", from.head);
  if (to !== null) params.set("to", to);
  const search = params.toString();

  const path = segments.map(encodeURIComponent).join("/");
  return `/${path}${search === "" ? "" : `?${search}`}${hash}`;
}

/** The href a link to a place on the pull request screen carries. */
export function pullHref(pull: PullPlace): string {
  return writePlace({ tab: "pulls", pull });
}
```

## Following the address

`usePlace` is the only code that touches `window.history`. A move the reader
did not ask for as a step, such as the pull request screen following the
commit scrolled to, replaces the entry instead of pushing one, so back skips
the scroll and returns to the place the reader came from.

```ts
//| id: frontend-state-place
//| file: src/frontend/state/place.ts
import { useCallback, useEffect, useState } from "react";
import { type Place, readPlace, writePlace } from "../model/place";

/** Whether a move leaves a step behind for back, or rewrites the one the
 *  reader is on. */
export type Visit = "push" | "replace";

export function usePlace(): [Place, (next: Place, visit?: Visit) => void] {
  const [place, setPlace] = useState<Place>(() => readPlace(window.location));

  useEffect(() => {
    const follow = () => setPlace(readPlace(window.location));
    window.addEventListener("popstate", follow);
    return () => window.removeEventListener("popstate", follow);
  }, []);

  const go = useCallback((next: Place, visit: Visit = "push") => {
    const { pathname, search, hash } = window.location;
    const address = writePlace(next);
    // Re-clicking the current place leaves no step for back to spend.
    if (address !== `${pathname}${search}${hash}`) {
      if (visit === "push") window.history.pushState(null, "", address);
      else window.history.replaceState(null, "", address);
    }
    // Read back what was written, so a place that does not survive the round
    // trip (line 0) shows up now rather than after a reload.
    setPlace(readPlace(window.location));
  }, []);

  return [place, go];
}
```

```ts
//| id: frontend-state-place

/** How many times back or forward has changed the address since mount. A
 *  screen scrolls to what is picked when this moves, and leaves the view
 *  alone when the reader's own click moved the place. */
export function useArrivals(): number {
  const [arrivals, setArrivals] = useState(0);

  useEffect(() => {
    const arrive = () => setArrivals((now) => now + 1);
    window.addEventListener("popstate", arrive);
    return () => window.removeEventListener("popstate", arrive);
  }, []);

  return arrivals;
}
```

## Tests

```ts
//| id: frontend-model-place-test
//| file: src/frontend/model/place.test.ts
import { describe, expect, test } from "bun:test";
import { GitOid } from "./history";
import { type Place, readPlace, writePlace } from "./place";

function oid(ch: string): GitOid {
  return GitOid.parse(ch.repeat(40));
}

function at(address: string): Place {
  return readPlace(new URL(address, "http://diffy"));
}

describe("readPlace", () => {
  test("reads the root as the local history screen", () => {
    expect(at("/")).toEqual({ tab: "local" });
  });

  test("reads every part of a pull request down to a line", () => {
    // arrange
    const address = `/pulls/41/commits/${oid("c")}/files/src/server.ts?from=${oid("a")}&to=${oid("b")}#L120`;

    // act
    const place = at(address);

    // assert
    expect(place).toEqual({
      tab: "pulls",
      pull: {
        number: 41,
        from: { kind: "version", head: oid("a") },
        to: oid("b"),
        spot: {
          commit: oid("c"),
          file: { path: "src/server.ts", line: 120 },
        },
      },
    });
  });

  test("keeps the file when its line does not parse", () => {
    const place = at(`/pulls/41/commits/${oid("c")}/files/a.ts#L0`);

    expect(place).toEqual({
      tab: "pulls",
      pull: {
        number: 41,
        from: { kind: "base" },
        to: null,
        spot: { commit: oid("c"), file: { path: "a.ts", line: null } },
      },
    });
  });

  test("drops a file whose commit does not parse", () => {
    const place = at("/pulls/41/commits/abc/files/a.ts#L3");

    expect(place).toEqual({
      tab: "pulls",
      pull: { number: 41, from: { kind: "base" }, to: null, spot: null },
    });
  });

  test("keeps the commit when its file does not decode", () => {
    const place = at(`/pulls/41/commits/${oid("c")}/files/%E0%A4%A#L3`);

    expect(place).toEqual({
      tab: "pulls",
      pull: {
        number: 41,
        from: { kind: "base" },
        to: null,
        spot: { commit: oid("c"), file: null },
      },
    });
  });

  test("opens the pull request afresh when a head does not parse", () => {
    const place = at(`/pulls/41/commits/${oid("c")}/files/a.ts?to=abc`);

    expect(place).toEqual({
      tab: "pulls",
      pull: { number: 41, from: { kind: "base" }, to: null, spot: null },
    });
  });

  test("reads a pull number that is not a number as the list", () => {
    expect(at("/pulls/x")).toEqual({ tab: "pulls", pull: null });
  });

  test("reads a path it does not know as the local history screen", () => {
    expect(at("/nowhere/41")).toEqual({ tab: "local" });
  });
});

describe("writePlace", () => {
  const places: Place[] = [
    { tab: "local" },
    { tab: "settings" },
    { tab: "pulls", pull: null },
    {
      tab: "pulls",
      pull: { number: 7, from: { kind: "base" }, to: null, spot: null },
    },
    {
      tab: "pulls",
      pull: {
        number: 7,
        from: { kind: "version", head: oid("a") },
        to: oid("b"),
        spot: { commit: oid("c"), file: null },
      },
    },
    {
      tab: "pulls",
      pull: {
        number: 7,
        from: { kind: "base" },
        to: oid("b"),
        spot: {
          commit: oid("c"),
          file: { path: "dir/a file&more#?.ts", line: 3 },
        },
      },
    },
  ];

  for (const place of places) {
    test(`reads back ${JSON.stringify(place)}`, () => {
      expect(at(writePlace(place))).toEqual(place);
    });
  }

  test("keeps the slashes of a file's path readable", () => {
    const address = writePlace({
      tab: "pulls",
      pull: {
        number: 7,
        from: { kind: "base" },
        to: null,
        spot: { commit: oid("c"), file: { path: "src/a.ts", line: 3 } },
      },
    });

    expect(address).toBe(`/pulls/7/commits/${oid("c")}/files/src/a.ts#L3`);
  });
});
```
