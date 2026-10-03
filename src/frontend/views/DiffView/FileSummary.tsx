// ~/~ begin <<docs/architecture/frontend/diff.md#frontend-view-diff-file-summary>>[init]
import { useMemo } from "react";
import { type ChangedFile, fileTree } from "../../model/changedFiles";
import { FileTree } from "../FileTree";

/** A table of contents for the files below, shown once there is more than
 *  one to summarise. Picking a row scrolls straight to that file's
 *  `<section>`, found by the same anchor id the section itself carries, so
 *  the summary needs no ref threaded down to reach it. */
export function FileSummary({ files }: { files: ChangedFile[] }) {
  const nodes = useMemo(() => fileTree(files), [files]);
  const totals = files.reduce(
    (sum, file) => ({
      added: sum.added + file.added,
      removed: sum.removed + file.removed,
    }),
    { added: 0, removed: 0 },
  );
  const changes = totals.added + totals.removed;

  return (
    <section className="file-summary" aria-label="Files changed">
      <header className="file-summary__head">
        <b className="file-summary__title">Files changed</b>
        <span className="file-summary__totals">
          <span>{files.length === 1 ? "1 file" : `${files.length} files`}</span>
          {totals.added > 0 && (
            <span className="file-summary__added">+{totals.added}</span>
          )}
          {totals.removed > 0 && (
            <span className="file-summary__removed">−{totals.removed}</span>
          )}
          {changes > 0 && (
            <span className="file-summary__bar">
              <span
                className="file-summary__bar-added"
                style={{ width: `${(totals.added / changes) * 100}%` }}
              />
              <span
                className="file-summary__bar-removed"
                style={{ width: `${(totals.removed / changes) * 100}%` }}
              />
            </span>
          )}
        </span>
      </header>
      <div className="file-summary__tree">
        <FileTree nodes={nodes} current={null} onPick={jumpTo} />
      </div>
    </section>
  );
}

function jumpTo(file: ChangedFile): void {
  document.getElementById(file.anchor)?.scrollIntoView({ block: "start" });
}
// ~/~ end
