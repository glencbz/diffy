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
import type { DiffLinks } from "../../model/place";
import { type Anchor, type DiffReview, isViewed } from "../../model/review";
import type { Display } from "../../model/settings";
import type { SourceLookup } from "../../model/source";
import { FileRow } from "./FileRow/FileRow";
import { FileSummary } from "./FileSummary";

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
            sources={sources}
            display={display}
            links={links}
            reveal={reveal}
            variant={
              review === undefined
                ? { kind: "plain-diff" }
                : {
                    kind: "review",
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
                    onEditComment: review.onEditComment,
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
