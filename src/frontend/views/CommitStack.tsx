// ~/~ begin <<docs/architecture/frontend/commit-stack.md#frontend-view-commit-stack>>[init]
import {
  type ReactElement,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import type { AsyncState } from "../model/asyncState";
import { type BeforePaths, compareOffer } from "../model/compared";
import type { FileDiff } from "../model/diff";
import type { GitCommit } from "../model/history";
import type { DiffLinks } from "../model/place";
import type {
  ComparisonReview,
  DiffReview,
  ReviewActions,
  ReviewBarVariant,
} from "../model/review";
import type { Display } from "../model/settings";
import type { SourceLookup } from "../model/source";
import { CommentComposer, CommentThreads } from "./Comments";
import { CommitMessage } from "./CommitMessage";
import { DiffView } from "./DiffView/DiffView";
import { ReviewBar } from "./ReviewBar";

// ~/~ end
// ~/~ begin <<docs/architecture/frontend/commit-stack.md#frontend-view-commit-stack>>[1]
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
  /** The row the graph pane last picked, or the reader last scrolled to. */
  current: string | null;
  /** The reader has scrolled a row other than `current` to the top. */
  onInView: (key: string) => void;
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
  beforePaths: BeforePaths;
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

/** How far below the top of the pane a row's top has to pass before the row
 *  is the one being read, in pixels. */
const READING_LINE = 60;

export function CommitStack({
  rows,
  sources,
  open,
  onToggle,
  expanded,
  onExpand,
  current,
  onInView,
  reveal,
  links,
  since,
  reviewOf,
  actions,
  beforePaths,
  display,
}: CommitStackProps): ReactElement {
  const stack = useRef<HTMLDivElement>(null);
  const revealedAt = useRef<number | null>(null);
  const latest = useRef({ rows, current, onInView });
  latest.current = { rows, current, onInView };

  useEffect(() => {
    const pane = stack.current?.closest(".pane--diff");
    if (!(pane instanceof HTMLElement)) return;

    let frame: number | null = null;
    const recompute = () => {
      frame = null;
      // A pick's own scroll is not the reader's; read it and a pick near the
      // end would be overruled at once by the last row.
      if (pane.scrollTop === revealedAt.current) return;
      revealedAt.current = null;
      const { rows, current, onInView } = latest.current;
      const paneTop = pane.getBoundingClientRect().top;
      const atBottom =
        pane.scrollTop + pane.clientHeight >= pane.scrollHeight - 2;
      let index = 0;
      [...(stack.current?.children ?? [])].forEach((section, position) => {
        const top = section.getBoundingClientRect().top - paneTop;
        // At the bottom the last row that has started counts, since a short
        // last commit never reaches the line.
        if (top <= READING_LINE || (atBottom && top < pane.clientHeight)) {
          index = position;
        }
      });
      const key = rows[index]?.key;
      if (key !== undefined && key !== current) onInView(key);
    };

    const onScroll = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(recompute);
    };

    pane.addEventListener("scroll", onScroll);
    return () => {
      pane.removeEventListener("scroll", onScroll);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, []);

  const onRevealed = () => {
    const pane = stack.current?.closest(".pane--diff");
    if (pane instanceof HTMLElement) revealedAt.current = pane.scrollTop;
  };

  return (
    <div ref={stack} className="commit-stack">
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
          onRevealed={onRevealed}
          links={links(row)}
          since={since}
          review={reviewOf(row)}
          actions={actions}
          beforePaths={beforePaths}
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
  onRevealed,
  links,
  since,
  review,
  actions,
  beforePaths,
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
  onRevealed: () => void;
  links: DiffLinks;
  since: string;
  review: ComparisonReview;
  actions: ReviewActions | null;
  beforePaths: BeforePaths;
  display: Display;
}) {
  const section = useRef<HTMLElement>(null);
  const [composing, setComposing] = useState(false);
  const parts = partsOf(actions, beforePaths, review, composing, setComposing);
  // Picking a commit in the graph scrolls its row to the top; picking it
  // again scrolls back, which is why this keys on `reveal`, a count of
  // requests. A linked file or line scrolls itself, so the row stays put.
  const diffScrolls = links.selected !== null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: reveal is the trigger; becoming current by a click in the diff must not scroll
  useEffect(() => {
    if (isCurrent && !diffScrolls) {
      section.current?.scrollIntoView({ block: "start" });
      onRevealed();
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
    <section ref={section} className="commit-stack__row">
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
            variant={parts.bar}
          />
          {parts.comments}
          <StackContents
            row={row}
            sources={sources}
            isOpen={isOpen}
            onToggle={onToggle}
            links={links}
            reveal={reveal}
            display={display}
            review={parts.diff}
          />
        </>
      )}
    </section>
  );
}

/** What a review document adds to a row that a row without one leaves out. */
interface RowParts {
  bar: ReviewBarVariant;
  /** The composer and threads on the whole commit, under the bar. */
  comments: ReactNode;
  diff: DiffReview | undefined;
}

function partsOf(
  actions: ReviewActions | null,
  beforePaths: BeforePaths,
  review: ComparisonReview,
  composing: boolean,
  setComposing: (composing: boolean) => void,
): RowParts {
  if (actions === null) {
    return { bar: { kind: "read-only" }, comments: null, diff: undefined };
  }
  return {
    bar: {
      kind: "writable",
      onMarkSeen: () => actions.markSeen(review),
      onComment: () => setComposing(true),
    },
    comments: (
      <>
        {composing && (
          <CommentComposer
            anchor={{ kind: "comparison" }}
            onCancel={() => setComposing(false)}
            onSubmit={(anchor, body) => {
              actions.addComment(review, anchor, body);
              setComposing(false);
            }}
          />
        )}
        <CommentThreads
          comments={review.comments.filter(
            (comment) => comment.kind === "comparison",
          )}
          onEditComment={actions.editComment}
          onResolveComment={actions.resolveComment}
          onDropComment={actions.dropComment}
          onReplyToComment={actions.replyToComment}
        />
      </>
    ),
    diff: {
      comments: review.comments,
      onAddComment: (anchor, body) => actions.addComment(review, anchor, body),
      onEditComment: actions.editComment,
      onResolveComment: actions.resolveComment,
      onDropComment: actions.dropComment,
      onReplyToComment: actions.replyToComment,
      viewed: review.viewed,
      onToggleViewed: (file) => actions.toggleViewed(review, file),
      compare: compareOffer(review, beforePaths, actions.compare),
    },
  };
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

/** What `ChangeCount` draws: files touched, lines added and removed. */
export type ChangeSize = { files: number; added: number; removed: number };

export function changeSize(files: FileDiff[]): ChangeSize {
  return { files: files.length, ...countLines(files) };
}

/** How many files a diff touches and how many lines it adds and removes.
 *  Two siblings rather than one wrapper, so they sit in whatever row holds
 *  them as that row's own items. */
export function ChangeCount({ size }: { size: ChangeSize }) {
  const { files, added, removed } = size;
  return (
    <>
      <span>{files === 1 ? "1 file" : `${files} files`}</span>
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
        <ChangeCount size={changeSize(files)} />
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
// ~/~ end
