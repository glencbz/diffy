// ~/~ begin <<docs/architecture/frontend/address.md#frontend-state-place>>[init]
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
// ~/~ end
// ~/~ begin <<docs/architecture/frontend/address.md#frontend-state-place>>[1]
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
// ~/~ end
// ~/~ begin <<docs/architecture/frontend/address.md#frontend-state-place>>[2]
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
// ~/~ end
// ~/~ begin <<docs/architecture/frontend/address.md#frontend-state-place>>[3]

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
// ~/~ end
