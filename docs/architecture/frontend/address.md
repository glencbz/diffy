# Address

Where a reader is lives in the address bar, so a link to it can be shared and a
reload puts the reader back in the same place. Which screen is open is there,
and on the pull request screen so are the pull request, the two heads it is
compared between, the commit picked in the graph, and the file and line picked
in a diff.

A pull request opened on a line reads like this, with the ids cut short here:

```
/pulls/41/commits/77d2…/files/src/server.ts?from=4c1e…&to=9a0b…#L120
```

The path names what is being read, from the screen down to the file. The
place is a hierarchy, and a path is one: a line means nothing without the
file it is in, a file nothing without its commit, and a commit nothing without
the pull request. Reading walks the path from the left and stops at the first
segment it cannot read, so a link cut short or mistyped by hand opens as much
of the place as still makes sense, instead of an error. The file's path is the
last thing in the path because it is the one part that holds slashes of its
own, and the line goes in the fragment after it, as `#L120`, the way GitHub
writes a line.

The two heads a pull request is compared between go in the query. They are
settings on the view rather than a step down into it, each has a default that
is left out (no `from` is the base, no `to` is the latest head), and either
can be set without the other. A commit is only found under the pair it was
picked under, so a head that does not parse ends the place at the pull
request. A head that parses but that the pull request never had is not caught
here, since only the pull request's history knows its heads, and it reads as
the error the commit list gives for any head it cannot fetch.

A query string holding every part would ask nothing of the server, which hands
out the same page for every address. It loses because it is flat: nothing in
`?pull=41&commit=…&file=…` says the commit sits under the pull request, so
the reader of the address and the code that parses it both have to know the
nesting from somewhere else. The server's side of paths is one catch-all
route, in [the server](../backend/server.md).

A line is an after-side line number, the one the gutter shows and the one a
comment is pinned to. A removed line has no after-side number, so it cannot be
linked yet, for the same reason it cannot be commented on yet.

## The place

`Place` is the parsed address. Its nesting is the nesting above, so a line
with no file is not a value the type can hold.

`to` is `null` until a reader picks a commit, a file, or a line. A link to a
pull request should open on its latest head, whatever that is by the time the
link is followed, but a commit id only means something under the head that
has it, so picking one pins the head it was picked under.

```ts
//| id: frontend-state-place
//| file: src/frontend/state/place.ts
import { useCallback, useEffect, useState } from "react";
import { GitOid, type PullBaseline } from "../api";

export type Place =
  | { tab: "local" }
  | { tab: "settings" }
  | { tab: "pulls"; pull: PullPlace | null };

export interface PullPlace {
  number: number;
  from: PullBaseline;
  /** `null` is whichever head is latest when the place is opened. */
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
  /** An after-side line number, the one the gutter shows. */
  line: number | null;
}

export function openPull(number: number): PullPlace {
  return { number, from: { kind: "base" }, to: null, spot: null };
}
```

Reading and writing are each other's inverse on every place the type can
hold, which the tests below check. Reading is where the address is treated as
untrusted input: anything a reader could have typed is parsed, and a part that
does not parse ends the place there.

```ts
//| id: frontend-state-place
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

`usePlace` is the one place the app touches `window.history`. Going somewhere
pushes an entry, so back returns to the place before it, a pull request, a
version, a commit, or a line at a time, the way a reader stepping through a
review expects. Going to the place already in the address pushes nothing, so
clicking the current commit again does not leave a step behind for back to
spend. A `popstate` reads the address again, and the screen follows.

The place it hands back is always the one read from the address it just
wrote, never the one it was given. A place that does not survive the round
trip, such as a line number of zero, then shows up on screen straight away
instead of only after a reload.

```ts
//| id: frontend-state-place
export function usePlace(): [Place, (next: Place) => void] {
  const [place, setPlace] = useState<Place>(() => readPlace(window.location));

  useEffect(() => {
    const follow = () => setPlace(readPlace(window.location));
    window.addEventListener("popstate", follow);
    return () => window.removeEventListener("popstate", follow);
  }, []);

  const go = useCallback((next: Place) => {
    const { pathname, search, hash } = window.location;
    const address = writePlace(next);
    if (address !== `${pathname}${search}${hash}`) {
      window.history.pushState(null, "", address);
    }
    setPlace(readPlace(window.location));
  }, []);

  return [place, go];
}
```

Following the address changes what is picked, but a screen also has to
bring what is picked into view, and only sometimes. A reader who clicks a line
is already looking at it, and one who presses back is not. `useArrivals`
counts the second kind, the times the address changed under the page rather
than through it, so a screen can scroll when that count moves and leave the
view alone when the reader's own click moved the place. Loading the page is
an arrival too, and a screen sees it as mounting.

```ts
//| id: frontend-state-place

/** How many times back or forward has changed the address since mount. */
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
//| id: frontend-state-place-test
//| file: src/frontend/state/place.test.ts
import { describe, expect, test } from "bun:test";
import { GitOid } from "../api";
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
