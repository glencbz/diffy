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

A local review's address has the same shape, with its name where the number
is and version numbers in the query, `/reviews/stack/commits/77d2…?from=1&to=2`.
Both kinds read what follows the series through one `readSeries`, handed the
rule for a version id: a head oid, or a number.

A [tour](tour.md) of either kind reads under `/tour`, as
`/tour/pulls/41/commits/77d2…?idea=store&with=apply`. A tour reads only the
newest version, so it has no heads to name, and what its map narrowed to is a
setting on the view like the heads are, so it goes in the query.

## The place

`Place`'s nesting is the path's, so a line without a file cannot be held.

```ts
//| id: frontend-model-place
//| file: src/frontend/model/place.ts
import { GitOid } from "./history";
import type { PullSummary } from "./pull";
import type { SeriesBaseline } from "./series";

export type Place =
  | { tab: "local" }
  | { tab: "settings" }
  | { tab: "pulls"; pull: PullPlace | null }
  | { tab: "reviews"; review: LocalPlace | null }
  | { tab: "local-tour"; review: LocalTourPlace | null }
  | { tab: "pull-tour"; pull: PullTourPlace | null };

/** Where the reader is in one series: the two versions compared, and what
 *  they picked out of them. */
export interface SeriesPlace {
  from: SeriesBaseline;
  /** `null` is whichever version is newest when the place is opened. Picking
   *  a commit pins it, since a commit id only means something under its
   *  version. */
  to: string | null;
  spot: CommitSpot | null;
}

export interface PullPlace extends SeriesPlace {
  number: number;
}

export interface LocalPlace extends SeriesPlace {
  name: string;
}

/** Where the reader is in a [tour](tour.md): the commit they read, and what
 *  its map narrowed the commit to. `null` is the oldest commit. */
export interface TourSpot {
  commit: GitOid | null;
  focus: TourFocus | null;
}

/** One idea, or an idea read beside one it relies on. */
export type TourFocus =
  | { kind: "idea"; id: string }
  | { kind: "link"; from: string; to: string };

export interface LocalTourPlace extends TourSpot {
  name: string;
}

export interface PullTourPlace extends TourSpot {
  number: number;
}

/** A commit picked in the graph, and what in its diff is picked. */
export interface CommitSpot {
  commit: string;
  file: FileSpot | null;
}

/** What the pull request screen shows for a place: the list alone, a pull
 *  request under review, or the list held over one as a sheet. */
export type PullChoice =
  | { phase: "browsing" }
  | { phase: "reviewing"; pull: PullSummary }
  | { phase: "picking"; pull: PullSummary };

/** A file in a diff, by its after-side path, and one of its lines. */
export interface FileSpot {
  path: string;
  /** An after-side line number, the one the gutter shows. A removed line has
   *  none, so it cannot be linked, as it cannot be commented on. */
  line: number | null;
}

/** Where the files and lines of a diff link to, for a diff whose place is
 *  kept in the address. */
export interface DiffLinks {
  /** The file or line the address names, when it is in this diff. */
  selected: FileSpot | null;
  href: (spot: FileSpot) => string;
  onFollow: (spot: FileSpot) => void;
}

const OPENED: SeriesPlace = { from: { kind: "base" }, to: null, spot: null };

export function openPull(number: number): PullPlace {
  return { number, ...OPENED };
}

export function openLocal(name: string): LocalPlace {
  return { name, ...OPENED };
}

/** A screen as it opens from its tab, with nothing picked on it yet. */
export function tabPlace(tab: Place["tab"]): Place {
  if (tab === "pulls") return { tab: "pulls", pull: null };
  if (tab === "reviews") return { tab: "reviews", review: null };
  if (tab === "local-tour") return { tab: "local-tour", review: null };
  if (tab === "pull-tour") return { tab: "pull-tour", pull: null };
  return { tab };
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
  if (tab === "pulls") {
    const [numberSegment, ...after] = rest;
    const number = positive(numberSegment);
    if (number === null) return { tab: "pulls", pull: null };
    const place = readSeries(after, address, oid);
    return { tab: "pulls", pull: { number, ...place } };
  }
  if (tab === "reviews") {
    const [nameSegment, ...after] = rest;
    const name = nameSegment === undefined ? null : decoded(nameSegment);
    if (name === null) return { tab: "reviews", review: null };
    const place = readSeries(after, address, (value) => {
      const number = positive(value);
      return number === null ? null : String(number);
    });
    return { tab: "reviews", review: { name, ...place } };
  }
  if (tab === "tour") {
    const [kind, series, ...after] = rest;
    if (kind === "reviews") {
      const name = series === undefined ? null : decoded(series);
      return {
        tab: "local-tour",
        review: name === null ? null : { name, ...readTour(after, address) },
      };
    }
    if (kind === "pulls") {
      const number = positive(series);
      return {
        tab: "pull-tour",
        pull: number === null ? null : { number, ...readTour(after, address) },
      };
    }
  }
  return { tab: "local" };
}

/** A place in a tour, from what follows the series in the address. */
function readTour(
  [commits, commitSegment]: string[],
  { search }: Address,
): TourSpot {
  const params = new URLSearchParams(search);
  const idea = params.get("idea");
  const withIdea = params.get("with");
  return {
    commit: commits === "commits" ? oid(commitSegment) : null,
    focus:
      idea === null
        ? null
        : withIdea === null
          ? { kind: "idea", id: idea }
          : { kind: "link", from: idea, to: withIdea },
  };
}

/** A place in one series, from what follows the series in the address.
 *  `version` reads a version id, and a pull request's is a head oid. */
function readSeries(
  [commits, commitSegment, files, ...pathSegments]: string[],
  { search, hash }: Address,
  version: (value: string | null) => string | null,
): SeriesPlace {
  const params = new URLSearchParams(search);
  const fromParam = params.get("from");
  const fromId = version(fromParam);
  const from: SeriesBaseline =
    fromId === null ? { kind: "base" } : { kind: "version", id: fromId };
  const toParam = params.get("to");
  const to = version(toParam);
  // A version that does not parse is a link to one nobody can find, and
  // reading on past it would pin a commit under whatever version stood in.
  if (
    (fromParam !== null && fromId === null) ||
    (toParam !== null && to === null)
  ) {
    return OPENED;
  }

  const commit = commits === "commits" ? oid(commitSegment) : null;
  if (commit === null) return { from, to, spot: null };

  const path =
    files === "files" && pathSegments.length > 0
      ? decoded(pathSegments.join("/"))
      : null;
  if (path === null) return { from, to, spot: { commit, file: null } };

  const line = positive(/^#L(.*)$/.exec(hash)?.[1]);
  return { from, to, spot: { commit, file: { path, line } } };
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
  if (place.tab === "pulls") {
    if (place.pull === null) return "/pulls";
    return writeSeries(["pulls", String(place.pull.number)], place.pull);
  }
  if (place.tab === "local-tour") {
    if (place.review === null) return "/tour/reviews";
    return writeTour(["tour", "reviews", place.review.name], place.review);
  }
  if (place.tab === "pull-tour") {
    if (place.pull === null) return "/tour/pulls";
    return writeTour(["tour", "pulls", String(place.pull.number)], place.pull);
  }
  if (place.review === null) return "/reviews";
  return writeSeries(["reviews", place.review.name], place.review);
}

function writeTour(segments: string[], { commit, focus }: TourSpot): string {
  if (commit !== null) segments.push("commits", commit);
  const params = new URLSearchParams();
  if (focus?.kind === "idea") params.set("idea", focus.id);
  if (focus?.kind === "link") {
    params.set("idea", focus.from);
    params.set("with", focus.to);
  }
  const search = params.toString();
  const path = segments.map(encodeURIComponent).join("/");
  return `/${path}${search === "" ? "" : `?${search}`}`;
}

function writeSeries(
  segments: string[],
  { from, to, spot }: SeriesPlace,
): string {
  let hash = "";
  if (spot !== null) {
    segments.push("commits", spot.commit);
    if (spot.file !== null) {
      segments.push("files", ...spot.file.path.split("/"));
      if (spot.file.line !== null) hash = `#L${spot.file.line}`;
    }
  }

  const params = new URLSearchParams();
  if (from.kind === "version") params.set("from", from.id);
  if (to !== null) params.set("to", to);
  const search = params.toString();

  const path = segments.map(encodeURIComponent).join("/");
  return `/${path}${search === "" ? "" : `?${search}`}${hash}`;
}

/** The href a link to a place on the pull request screen carries. */
export function pullHref(pull: PullPlace): string {
  return writePlace({ tab: "pulls", pull });
}

/** The href a link to a place in a local review carries. */
export function localHref(review: LocalPlace): string {
  return writePlace({ tab: "reviews", review });
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
        from: { kind: "version", id: oid("a") },
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

  test("reads a local review by name, its versions by number", () => {
    const place = at(`/reviews/stack%2Fone/commits/${oid("c")}?from=2&to=3`);

    expect(place).toEqual({
      tab: "reviews",
      review: {
        name: "stack/one",
        from: { kind: "version", id: "2" },
        to: "3",
        spot: { commit: oid("c"), file: null },
      },
    });
  });

  test("opens a local review afresh when a version is not a number", () => {
    expect(at("/reviews/stack?from=v2")).toEqual({
      tab: "reviews",
      review: { name: "stack", from: { kind: "base" }, to: null, spot: null },
    });
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
        from: { kind: "version", id: oid("a") },
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
    { tab: "reviews", review: null },
    {
      tab: "reviews",
      review: {
        name: "stack/one",
        from: { kind: "version", id: "1" },
        to: "2",
        spot: { commit: oid("c"), file: { path: "src/a.ts", line: 9 } },
      },
    },
    { tab: "local-tour", review: null },
    { tab: "pull-tour", pull: null },
    {
      tab: "local-tour",
      review: {
        name: "stack/one",
        commit: oid("c"),
        focus: { kind: "idea", id: "the store" },
      },
    },
    {
      tab: "pull-tour",
      pull: {
        number: 7,
        commit: null,
        focus: { kind: "link", from: "a", to: "b" },
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
