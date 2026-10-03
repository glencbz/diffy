// ~/~ begin <<docs/architecture/frontend/diff.md#frontend-view-diff>>[init]
import { useMemo, useState } from "react";
import {
  afterPathOf,
  changedFile,
  fileAnchor,
  fileVersionOf,
  shownPathOf,
} from "../../model/changedFiles";
import type { FileDiff } from "../../model/diff";
import type { FileSpot } from "../../model/place";
import {
  type Anchor,
  type FileVersion,
  isViewed,
  type RowComment,
  type ViewedFile,
} from "../../model/review";
import type { Display } from "../../model/settings";
import type { SourceLookup } from "../../model/source";
import { sidesOf } from "./FileRow/drawnLines";
import { FileRow } from "./FileRow/FileRow";
import { fileLinks } from "./FileRow/links";
import { FileSummary } from "./FileSummary";

/** Review memory for the files on screen. A diff that has one lets every
 * file, and every line of it on either side, be commented on; a diff that
 * has none renders read-only. */
export interface DiffReview {
  comments: RowComment[];
  onAddComment: (anchor: Anchor, body: string) => void;
  onResolveComment: (id: string, resolved: boolean) => void;
  onDropComment: (id: string) => void;
  viewed: ViewedFile[];
  onToggleViewed: (file: FileVersion) => void;
}

/** Where the files and lines of a diff link to, for a diff whose place is
 *  kept in the address. */
export interface DiffLinks {
  /** The file or line the address names, when it is in this diff. */
  selected: FileSpot | null;
  href: (spot: FileSpot) => string;
  onFollow: (spot: FileSpot) => void;
}

export function DiffView({
  files,
  sources,
  review,
  scope,
  links,
  reveal,
  display,
}: {
  files: FileDiff[];
  sources?: SourceLookup;
  review?: DiffReview;
  /** Scopes this diff's file ids apart from any other diff on the page: a
   *  comparison row's key, or a pull request stack row's commit id. */
  scope: string;
  links?: DiffLinks;
  /** Changes each time the selected file or line should be brought into
   *  view. Mounting brings it into view too. */
  reveal?: number;
  /** How the reader asked for diffs to be drawn. */
  display: Display;
}) {
  const [composer, setComposer] = useState<Anchor | null>(null);

  const changedFiles = useMemo(
    () =>
      files.map((file) =>
        changedFile(
          file,
          fileAnchor(scope, afterPathOf(file)),
          review?.comments ?? [],
        ),
      ),
    [files, review?.comments, scope],
  );

  return (
    <div className="diff-view">
      {changedFiles.length >= 2 && <FileSummary files={changedFiles} />}
      {files.map((file) => {
        const path = shownPathOf(file);
        const anchor = fileAnchor(scope, afterPathOf(file));
        return (
          <FileRow
            key={path}
            anchor={anchor}
            file={file}
            sides={sidesOf(file, sources)}
            display={display}
            links={links === undefined ? undefined : fileLinks(links, file)}
            reveal={reveal}
            review={
              review === undefined
                ? undefined
                : {
                    comments: review.comments.filter(
                      (comment) =>
                        comment.kind !== "comparison" && comment.path === path,
                    ),
                    composer:
                      composer !== null &&
                      composer.kind !== "comparison" &&
                      composer.path === path
                        ? composer
                        : null,
                    onOpenComposer: setComposer,
                    onCancelComposer: () => setComposer(null),
                    onSubmitComposer: (anchor, body) => {
                      review.onAddComment(anchor, body);
                      setComposer(null);
                    },
                    onResolveComment: review.onResolveComment,
                    onDropComment: review.onDropComment,
                    viewed: isViewed(review.viewed, fileVersionOf(file)),
                    onToggleViewed: () =>
                      review.onToggleViewed(fileVersionOf(file)),
                  }
            }
          />
        );
      })}
    </div>
  );
}
// ~/~ end
