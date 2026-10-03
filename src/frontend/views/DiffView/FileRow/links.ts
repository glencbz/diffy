// ~/~ begin <<docs/architecture/frontend/diff.md#frontend-view-diff-file-links>>[init]
import type { MouseEvent } from "react";
import { afterPathOf } from "../../../model/changedFiles";
import type { FileDiff } from "../../../model/diff";
import type { FileSpot } from "../../../model/place";
import type { DiffLinks } from "../DiffView";

/** `DiffLinks` narrowed to one file. */
export interface FileLinks {
  /** This file's place in the address, when the address names it. */
  selected: FileSpot | null;
  href: (line: number | null) => string;
  onFollow: (line: number | null) => void;
}

export function fileLinks(links: DiffLinks, file: FileDiff): FileLinks {
  const path = afterPathOf(file);
  return {
    selected: links.selected?.path === path ? links.selected : null,
    href: (line) => links.href({ path, line }),
    onFollow: (line) => links.onFollow({ path, line }),
  };
}

/** A plain click on a link is followed in place. One asking for a new tab
 *  or window is left to the browser, which is what the `href` is for. */
export function follow(event: MouseEvent, onFollow: () => void): void {
  if (
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return;
  }
  event.preventDefault();
  onFollow();
}
// ~/~ end
