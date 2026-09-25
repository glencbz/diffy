// ~/~ begin <<docs/architecture/frontend/pull-requests.md#frontend-state-last-reviewed>>[init]
import { useCallback, useState } from "react";
import * as z from "zod";
import { GitOid, type PullVersion } from "../api";
import type { PullPlace } from "./place";

export const LastReviewed = z.object({ head: GitOid });
export type LastReviewed = z.infer<typeof LastReviewed>;

function storageKey(repo: string, number: number): string {
  return `diffy.last-reviewed.v1:${repo}#${number}`;
}

/** localStorage content is written by a possibly older version of this
 * app, or by hand in devtools; a value that does not parse reads as no
 * mark at all. */
export function load(repo: string, number: number): GitOid | null {
  const raw = localStorage.getItem(storageKey(repo, number));
  if (raw === null) return null;

  try {
    return LastReviewed.parse(JSON.parse(raw)).head;
  } catch {
    return null;
  }
}

/** setItem throws in Safari private browsing and over quota; a mark that
 * holds for the tab without persisting beats a click that throws. */
export function save(repo: string, number: number, head: GitOid): void {
  const value: LastReviewed = { head };
  try {
    localStorage.setItem(storageKey(repo, number), JSON.stringify(value));
  } catch {
    // See the doc comment: persistence failure is not worth a UI state.
  }
}

export function useLastReviewed(
  repo: string,
  number: number,
): [GitOid | null, (head: GitOid) => void] {
  const [head, setHead] = useState(() => load(repo, number));
  const mark = useCallback(
    (next: GitOid) => {
      save(repo, number, next);
      setHead(next);
    },
    [repo, number],
  );
  return [head, mark];
}
// ~/~ end
// ~/~ begin <<docs/architecture/frontend/pull-requests.md#frontend-state-last-reviewed>>[1]
/** The place a pull request opens on, given the head this reader last
 *  reviewed and the heads the pull request has had, oldest first. */
export function opening(
  place: PullPlace,
  reviewed: GitOid | null,
  states: PullVersion[],
): PullPlace {
  const bare =
    place.from.kind === "base" && place.to === null && place.spot === null;
  if (!bare || reviewed === null || reviewed === states.at(-1)?.head) {
    return place;
  }
  if (!states.some((state) => state.head === reviewed)) return place;
  return { ...place, from: { kind: "version", head: reviewed } };
}
// ~/~ end
