# Commit stack

`CommitStack` reads a pull request one section per commit, top to bottom,
rather than as one squashed patch that loses which commit each hunk came
from. Each section shows its message (a [`CommitMessage`](commit-message.md),
cut to its opening) and keeps its diff folded until asked for, so a reader
sees every commit and opens only the ones that matter.

```ts
//| id: frontend-view-commit-stack
//| file: src/frontend/views/CommitStack.tsx
import { type ReactElement, useEffect, useRef, useState } from "react";
import type { AsyncState } from "../model/asyncState";
import type { FileDiff } from "../model/diff";
import type { GitCommit } from "../model/history";
import type { ComparisonReview, ReviewActions } from "../model/review";
import type { Display } from "../model/settings";
import type { SourceLookup } from "../model/source";
import { CommitMessage } from "./CommitMessage";
import {
  CommentComposer,
  CommentThreads,
  type DiffLinks,
  type DiffReview,
  DiffView,
} from "./DiffView";
import { ReviewBar } from "./ReviewBar";

```

## The view

A dropped or unchanged row has nothing to decide and collapses to its spine
and a one-line caption, with a control to reopen it. A reworded row shows
the old message against the new, from the `JJ-COMMIT-DESCRIPTION` file
`jj interdiff` emits. Each row carries the [review bar](review.md#the-review-bar)
and takes comments and viewed marks like a comparison does, reading
`reviewOf(row)`; without a review document its diff is read-only.

```tsx
//| id: frontend-view-commit-stack
export type StackRowKind =
  | "added"
  | "dropped"
  | "amended"
  | "reworded"
  | "unchanged"
  | "plain";

type QuietKind = "dropped" | "unchanged";

/** The two kinds that want no attention. One is gone and the other did not
 *  move, so both collapse to a line until the reader asks for them. A
 *  predicate rather than a boolean, so the row that follows is known to be
 *  one of the two without being told so a second time. */
function isQuiet(kind: StackRowKind): kind is QuietKind {
  return kind === "dropped" || kind === "unchanged";
}

export interface StackRow {
  /** Stable across a re-render, the commit this row is about. */
  key: string;
  kind: StackRowKind;
  /** The commit this row shows. For a dropped row that is the old one. */
  commit: GitCommit;
  /** The commit it was, when the row pairs two. */
  was: GitCommit | null;
  /** The comparison this row shows. An `AsyncState` rather than a nullable
   *  array, so a fetch that failed is a state the row can draw instead of a
   *  row that loads forever. */
  files: AsyncState<FileDiff[]>;
}

export interface CommitStackProps {
  rows: StackRow[];
  /** Each side of each file, for an open row's diff to colour. */
  sources: SourceLookup;
  /** Rows whose contents are open. */
  open: ReadonlySet<string>;
  onToggle: (key: string) => void;
  /** Rows whose whole message is showing. */
  expanded: ReadonlySet<string>;
  onExpand: (key: string) => void;
  /** The row the graph pane last picked. */
  current: string | null;
  /** Changes each time the current row should be brought into view. */
  reveal: number;
  /** Where each row's files and lines link to. */
  links: (row: StackRow) => DiffLinks;
  /** The older version every non-plain row is read against, as its chip
   *  names it: `v5`. */
  since: string;
  /** What the reader has kept on each row. */
  reviewOf: (row: StackRow) => ComparisonReview;
  /** Null while there is no review document to write to. */
  actions: ReviewActions | null;
  /** How the reader asked for diffs to be drawn. */
  display: Display;
}

/** A row that stands in some relation to an older version says so. Reading a
 *  pull request against its base has no older version to relate to, so
 *  `plain` is absent here and its rows wear no chip. */
const KIND_LABEL: Record<Exclude<StackRowKind, "plain">, string> = {
  added: "new",
  dropped: "dropped",
  amended: "amended",
  reworded: "message changed",
  unchanged: "unchanged",
};

type ChipTone = "resolved" | "stale" | "open";

const TONE_CLASS: Record<ChipTone, string> = {
  resolved: "review-chip--resolved",
  stale: "review-chip--stale",
  open: "review-chip--open",
};

/** How much a kind is worth flagging. Unchanged carries nothing to act on,
 *  amended and reworded are a change worth a look, and added and dropped
 *  both deviate from the older version and want the same weight. */
const KIND_TONE: Record<Exclude<StackRowKind, "plain">, ChipTone> = {
  added: "open",
  dropped: "open",
  amended: "stale",
  reworded: "stale",
  unchanged: "resolved",
};

export function CommitStack({
  rows,
  sources,
  open,
  onToggle,
  expanded,
  onExpand,
  current,
  reveal,
  links,
  since,
  reviewOf,
  actions,
  display,
}: CommitStackProps): ReactElement {
  return (
    <div className="commit-stack">
      {rows.map((row) => (
        <StackSection
          key={row.key}
          row={row}
          sources={sources}
          isOpen={open.has(row.key)}
          onToggle={() => onToggle(row.key)}
          isExpanded={expanded.has(row.key)}
          onExpand={() => onExpand(row.key)}
          isCurrent={current === row.key}
          reveal={reveal}
          links={links(row)}
          since={since}
          review={reviewOf(row)}
          actions={actions}
          display={display}
        />
      ))}
    </div>
  );
}

function StackSection({
  row,
  sources,
  isOpen,
  onToggle,
  isExpanded,
  onExpand,
  isCurrent,
  reveal,
  links,
  since,
  review,
  actions,
  display,
}: {
  row: StackRow;
  sources: SourceLookup;
  isOpen: boolean;
  onToggle: () => void;
  isExpanded: boolean;
  onExpand: () => void;
  isCurrent: boolean;
  reveal: number;
  links: DiffLinks;
  since: string;
  review: ComparisonReview;
  actions: ReviewActions | null;
  display: Display;
}) {
  const section = useRef<HTMLElement>(null);
  const [composing, setComposing] = useState(false);
  // Picking a commit in the graph scrolls its row to the top; picking it
  // again scrolls back, which is why this keys on `reveal`, a count of
  // requests. A linked file or line scrolls itself, so the row stays put.
  const diffScrolls = links.selected !== null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: reveal is the trigger; becoming current by a click in the diff must not scroll
  useEffect(() => {
    if (isCurrent && !diffScrolls) {
      section.current?.scrollIntoView({ block: "start" });
    }
  }, [reveal]);

  // File headers stick below the sticky spine, whose height wraps and
  // follows the text size, so it is measured rather than written down.
  useEffect(() => {
    const row = section.current;
    const spine = row?.querySelector(".commit-stack__spine");
    if (row == null || !(spine instanceof HTMLElement)) return;
    const observer = new ResizeObserver(() => {
      row.style.setProperty("--diff-sticky-top", `${spine.offsetHeight}px`);
    });
    observer.observe(spine);
    return () => observer.disconnect();
  }, []);

  return (
    <section
      ref={section}
      className={
        isCurrent
          ? "commit-stack__row commit-stack__row--current"
          : "commit-stack__row"
      }
    >
      <StackSpine row={row} since={since} />
      {isQuiet(row.kind) && !isOpen ? (
        <QuietLine kind={row.kind} onOpen={onToggle} />
      ) : (
        <>
          <StackMeta row={row} />
          <CommitMessage
            description={row.commit.description}
            className="commit-stack__message"
            isExpanded={isExpanded}
            onExpand={onExpand}
          />
          <ReviewBar
            review={review}
            files={row.files.status === "ready" ? row.files.data : []}
            commentLabel="comment on this commit"
            onMarkSeen={actions && (() => actions.markSeen(review))}
            onComment={actions && (() => setComposing(true))}
          />
          {actions !== null && composing && (
            <CommentComposer
              anchor={{ kind: "comparison" }}
              onCancel={() => setComposing(false)}
              onSubmit={(anchor, body) => {
                actions.addComment(review, anchor, body);
                setComposing(false);
              }}
            />
          )}
          {actions !== null && (
            <CommentThreads
              comments={review.comments.filter(
                (comment) => comment.kind === "comparison",
              )}
              onResolveComment={actions.resolveComment}
              onDropComment={actions.dropComment}
            />
          )}
          <StackContents
            row={row}
            sources={sources}
            isOpen={isOpen}
            onToggle={onToggle}
            links={links}
            reveal={reveal}
            display={display}
            review={
              actions === null
                ? undefined
                : {
                    comments: review.comments,
                    onAddComment: (anchor, body) =>
                      actions.addComment(review, anchor, body),
                    onResolveComment: actions.resolveComment,
                    onDropComment: actions.dropComment,
                    viewed: review.viewed,
                    onToggleViewed: (file) =>
                      actions.toggleViewed(review, file),
                  }
            }
          />
        </>
      )}
    </section>
  );
}

function StackSpine({ row, since }: { row: StackRow; since: string }) {
  const shortId = row.commit.commitId.slice(0, 8);
  const subject = row.commit.description.split("\n")[0] ?? "";

  return (
    <header className="commit-stack__spine">
      <span className="commit-stack__id">{shortId}</span>
      <span
        className={
          row.kind === "dropped"
            ? "commit-stack__subject commit-stack__subject--dropped"
            : "commit-stack__subject"
        }
      >
        {subject}
      </span>
      {row.kind === "plain" ? null : (
        <span className={`review-chip ${TONE_CLASS[KIND_TONE[row.kind]]}`}>
          {KIND_LABEL[row.kind]} since {since}
        </span>
      )}
    </header>
  );
}

const QUIET_LINE: Record<QuietKind, string> = {
  dropped: "this commit is gone from the branch",
  unchanged: "this commit made it through untouched",
};

function QuietLine({ kind, onOpen }: { kind: QuietKind; onOpen: () => void }) {
  return (
    <p className="commit-stack__quiet">
      <span>{QUIET_LINE[kind]}</span>
      <button
        type="button"
        className="commit-stack__quiet-open"
        onClick={onOpen}
      >
        read it anyway
      </button>
    </p>
  );
}

function StackMeta({ row }: { row: StackRow }) {
  const date = row.commit.authoredAt.slice(0, 10);
  return (
    <p className="commit-stack__meta">
      {row.commit.author} · {date}
      {row.was !== null ? ` · was ${row.was.commitId.slice(0, 8)}` : null}
    </p>
  );
}

function emptyContentsText(kind: StackRowKind): string {
  if (kind === "unchanged") return "the commit makes the same change it did.";
  return "the commit changes nothing.";
}

function contentsCaption(kind: StackRowKind): string {
  if (kind === "amended" || kind === "reworded") {
    return "what changed in this commit";
  }
  if (kind === "dropped") return "what this commit used to add";
  return "what this commit adds";
}

/** Added and removed line counts across every file's patch, for the fold
 *  button. A line counts once, by its leading character, never by parsing
 *  the patch into hunks the button has no use for. */
export function countLines(files: FileDiff[]): {
  added: number;
  removed: number;
} {
  let added = 0;
  let removed = 0;
  for (const file of files) {
    for (const line of file.patch.split("\n")) {
      if (line.startsWith("+") && !line.startsWith("+++")) added++;
      else if (line.startsWith("-") && !line.startsWith("---")) removed++;
    }
  }
  return { added, removed };
}

/** How many files a diff touches and how many lines it adds and removes.
 *  Two siblings rather than one wrapper, so they sit in whatever row holds
 *  them as that row's own items. */
export function ChangeCount({ files }: { files: FileDiff[] }) {
  const { added, removed } = countLines(files);
  return (
    <>
      <span>{files.length === 1 ? "1 file" : `${files.length} files`}</span>
      <span>
        <span className="change-count__added">+{added}</span>{" "}
        <span className="change-count__removed">-{removed}</span>
      </span>
    </>
  );
}

function StackContents({
  row,
  sources,
  isOpen,
  onToggle,
  links,
  reveal,
  review,
  display,
}: {
  row: StackRow;
  sources: SourceLookup;
  isOpen: boolean;
  onToggle: () => void;
  links: DiffLinks;
  reveal: number;
  review: DiffReview | undefined;
  display: Display;
}) {
  if (row.files.status === "loading") {
    return (
      <p className="commit-stack__loading">the comparison is still loading</p>
    );
  }
  if (row.files.status === "error") {
    return <p className="commit-stack__failed">{row.files.message}</p>;
  }

  const files = row.files.data;
  if (files.length === 0) {
    return <p className="commit-stack__empty">{emptyContentsText(row.kind)}</p>;
  }

  return (
    <div className="commit-stack__contents">
      <button type="button" className="commit-stack__fold" onClick={onToggle}>
        <ChangeCount files={files} />
        <span className="commit-stack__fold-caption">
          {contentsCaption(row.kind)}
        </span>
      </button>
      {isOpen && (
        <DiffView
          files={files}
          sources={sources}
          scope={row.commit.commitId}
          links={links}
          reveal={reveal}
          review={review}
          display={display}
        />
      )}
    </div>
  );
}
```

## Styling

The spine sticks to the top of the pane so a reader deep in a long patch
still sees whose commit it is. A dropped subject is struck through, since
muted alone would read as "unchanged".

```css
/*| id: design-commit-stack
@layer components {
  .commit-stack {
    display: flex;
    flex-direction: column;
  }

  .commit-stack__row {
    border-bottom: 1px solid var(--border);
  }

  .commit-stack__row--current {
    background: var(--surface-selected);
  }

  .commit-stack__spine {
    position: sticky;
    top: 0;
    display: flex;
    align-items: baseline;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-5);
    background: var(--surface-raised);
    border-bottom: 1px solid var(--border);
  }

  .commit-stack__id {
    font-family: var(--font-mono);
    font-size: var(--text-size-small);
    color: var(--text-muted);
  }

  .commit-stack__subject {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .commit-stack__subject--dropped {
    color: var(--text-muted);
    text-decoration: line-through;
  }

  .commit-stack__meta {
    margin: 0;
    padding: var(--space-2) var(--space-5) 0;
    font-size: var(--text-size-small);
    color: var(--text-muted);
  }

  .commit-stack__row > .review-bar {
    padding: 0 var(--space-5);
  }

  .commit-stack__message {
    max-width: 72ch;
    padding: var(--space-3) var(--space-5);
  }

  .commit-stack__quiet {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-3) var(--space-5);
    font-style: italic;
    color: var(--text-muted);
  }

  .commit-stack__quiet-open {
    padding: 0;
    font: inherit;
    font-style: normal;
    color: var(--accent);
    cursor: pointer;
    background: transparent;
    border: none;
  }

  .commit-stack__loading,
  .commit-stack__empty {
    padding: var(--space-5);
    font-style: italic;
    color: var(--text-muted);
  }

  .commit-stack__failed {
    padding: var(--space-5);
    color: var(--danger);
  }

  .commit-stack__contents {
    padding-bottom: var(--space-3);
  }

  .commit-stack__fold {
    display: flex;
    align-items: center;
    width: 100%;
    gap: var(--space-4);
    padding: var(--space-3) var(--space-5);
    font: inherit;
    color: inherit;
    text-align: left;
    cursor: pointer;
    background: transparent;
    border: none;
  }

  .commit-stack__fold:hover {
    background: var(--surface-sunken);
  }

  .commit-stack__fold-caption {
    color: var(--text-muted);
  }

  .change-count__added {
    color: var(--diff-added);
  }

  .change-count__removed {
    color: var(--diff-removed);
  }
}
```

```css
/*| id: design-commit-stack
@layer components-narrow {
  @media (max-width: 1000px) {
    .commit-stack__spine {
      flex-wrap: wrap;
      gap: var(--space-2);
      padding: var(--space-2) var(--space-4);
    }

    .commit-stack__message {
      max-width: none;
    }

    .commit-stack__fold-caption {
      display: none;
    }
  }
}
```

## Tests

```ts
//| id: frontend-view-commit-stack-test
//| file: src/frontend/views/CommitStack.test.ts
import { describe, expect, test } from "bun:test";
import type { FileDiff } from "../model/diff";
import { countLines } from "./CommitStack";

describe("countLines", () => {
  test("ignores the +++/--- file header lines", () => {
    // arrange
    const files: FileDiff[] = [
      {
        status: "modified",
        path: "a.ts",
        binary: false,
        oldBlob: null,
        newBlob: null,
        patch: "--- a/a.ts\n+++ b/a.ts\n+added line\n-removed line\n context",
        structural: { kind: "unavailable", reason: "not diffed" },
      },
    ];

    // act
    const { added, removed } = countLines(files);

    // assert
    expect(added).toBe(1);
    expect(removed).toBe(1);
  });
});
```
