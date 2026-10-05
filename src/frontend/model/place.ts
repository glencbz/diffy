// ~/~ begin <<docs/architecture/frontend/address.md#frontend-model-place>>[init]
import { GitOid } from "./history";
import type { PullSummary } from "./pull";
import type { SeriesBaseline } from "./series";

export type Place =
  | { tab: "local" }
  | { tab: "settings" }
  | { tab: "pulls"; pull: PullPlace | null }
  | { tab: "reviews"; review: LocalPlace | null };

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
  return { tab };
}
// ~/~ end
// ~/~ begin <<docs/architecture/frontend/address.md#frontend-model-place>>[1]
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
  return { tab: "local" };
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
  if (place.review === null) return "/reviews";
  return writeSeries(["reviews", place.review.name], place.review);
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
// ~/~ end
