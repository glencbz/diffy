// ~/~ begin <<docs/architecture/frontend/commit-stack.md#frontend-view-commit-stack>>[init]
import { type ReactElement, useEffect, useRef } from "react";
import type { FileDiff, GitCommit } from "../api";
import type { AsyncState } from "../state/asyncState";
import type { SourceLookup } from "../state/source";
import { DiffView } from "./DiffView";

/** The opening of a commit body, its first paragraph or its first six
 *  lines, whichever runs shorter. Counts source lines, the ones the author
 *  wrote, not rendered lines. This repo wraps commit bodies at 72 columns,
 *  so counting rendered lines would show a different amount of the same
 *  commit depending on how wide the window happens to be. `rest` counts
 *  only the lines with text on them, the ones a reader would be promised. */
export function opening(body: string): { text: string; rest: number } {
  const lines = body.split("\n");
  const blank = lines.findIndex((line) => line.trim() === "");
  const taken = Math.min(blank === -1 ? lines.length : blank, 6);
  return {
    text: lines.slice(0, taken).join("\n"),
    rest: lines.slice(taken).filter((line) => line.trim() !== "").length,
  };
}
// ~/~ end
// ~/~ begin <<docs/architecture/frontend/commit-stack.md#frontend-view-commit-stack>>[1]

export type MessageBlock =
  | { kind: "paragraph"; text: string }
  | { kind: "bullets"; items: string[] }
  | { kind: "pre"; text: string };

/** A commit body as blocks, so its paragraphs and its bulleted inventory
 *  survive being re-wrapped to a narrow window. */
export function messageBlocks(body: string): MessageBlock[] {
  const blocks: MessageBlock[] = [];
  for (const chunk of chunksOf(body)) {
    const lines = chunk.split("\n");
    if (startsBullet(lines[0] ?? "")) {
      blocks.push({ kind: "bullets", items: bulletItems(lines) });
    } else if (lines.every(isIndented)) {
      blocks.push({ kind: "pre", text: chunk });
    } else {
      const text = lines
        .map((line) => line.trim())
        .join(" ")
        .trim();
      if (text !== "") blocks.push({ kind: "paragraph", text });
    }
  }
  return blocks;
}

/** Splits on blank lines. A chunk holds none of its own, so a caller never
 *  has to skip one while reading a chunk's lines. */
function chunksOf(body: string): string[] {
  const chunks: string[] = [];
  let current: string[] = [];
  for (const line of body.split("\n")) {
    if (line.trim() === "") {
      if (current.length > 0) chunks.push(current.join("\n"));
      current = [];
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) chunks.push(current.join("\n"));
  return chunks;
}

function startsBullet(line: string): boolean {
  return line.startsWith("- ") || line.startsWith("* ");
}

function isIndented(line: string): boolean {
  return line.startsWith("\t") || line.startsWith("  ");
}

function bulletItems(lines: string[]): string[] {
  const items: string[] = [];
  for (const line of lines) {
    if (startsBullet(line)) {
      items.push(line.slice(2).trim());
      continue;
    }
    const last = items[items.length - 1];
    if (last !== undefined) items[items.length - 1] = `${last} ${line.trim()}`;
  }
  return items;
}
// ~/~ end
// ~/~ begin <<docs/architecture/frontend/commit-stack.md#frontend-view-commit-stack>>[2]

const TRAILER = /^(Co-authored-by|Co-Authored-By|Signed-off-by):/;

/** A commit message split into the parts that are shown differently. */
export function splitMessage(description: string): {
  subject: string;
  body: string;
  trailers: string;
} {
  const [subject, ...rest] = description.split("\n");
  let bodyLines = rest;
  while (bodyLines.length > 0 && (bodyLines[0] ?? "").trim() === "") {
    bodyLines = bodyLines.slice(1);
  }
  const lines = bodyLines.join("\n").trimEnd().split("\n");

  let cut = lines.length;
  let i = lines.length - 1;
  while (i >= 0) {
    const line = lines[i] ?? "";
    if (line.trim() === "") {
      i--;
      continue;
    }
    if (TRAILER.test(line)) {
      cut = i;
      i--;
      continue;
    }
    break;
  }

  if (cut === lines.length) {
    return { subject: subject ?? "", body: lines.join("\n"), trailers: "" };
  }
  return {
    subject: subject ?? "",
    body: lines.slice(0, cut).join("\n").trimEnd(),
    trailers: lines.slice(cut).join("\n"),
  };
}
// ~/~ end
// ~/~ begin <<docs/architecture/frontend/commit-stack.md#frontend-view-commit-stack>>[3]

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
  /** The row the graph pane last picked, brought into view when it changes. */
  current: string | null;
  /** How many picks the graph pane has made, so picking the current row
   *  again brings it back into view too. */
  picks: number;
  /** The older version every non-plain row is read against, as its chip
   *  names it: `v5`. */
  since: string;
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
  picks,
  since,
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
          picks={picks}
          since={since}
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
  picks,
  since,
}: {
  row: StackRow;
  sources: SourceLookup;
  isOpen: boolean;
  onToggle: () => void;
  isExpanded: boolean;
  onExpand: () => void;
  isCurrent: boolean;
  picks: number;
  since: string;
}) {
  const section = useRef<HTMLElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: picks is the trigger, not a value read
  useEffect(() => {
    if (isCurrent) section.current?.scrollIntoView({ block: "start" });
  }, [isCurrent, picks]);

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
          <StackMessage
            commit={row.commit}
            isExpanded={isExpanded}
            onExpand={onExpand}
          />
          <StackContents
            row={row}
            sources={sources}
            isOpen={isOpen}
            onToggle={onToggle}
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

function StackMessage({
  commit,
  isExpanded,
  onExpand,
}: {
  commit: GitCommit;
  isExpanded: boolean;
  onExpand: () => void;
}) {
  const { body, trailers } = splitMessage(commit.description);
  const { text, rest } = opening(body);
  const blocks = messageBlocks(isExpanded ? body : text);

  return (
    <div className="commit-stack__message">
      {blocks.map((block, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static, non-reordering message blocks
        <MessageBlockView key={index} block={block} />
      ))}
      {rest > 0 && (
        <button
          type="button"
          className="commit-stack__expand"
          onClick={onExpand}
        >
          {isExpanded
            ? "fold the message"
            : `read the rest of the message, ${rest} lines`}
        </button>
      )}
      {isExpanded && trailers !== "" && (
        <p className="commit-stack__trailers">{trailers}</p>
      )}
    </div>
  );
}

function MessageBlockView({ block }: { block: MessageBlock }) {
  if (block.kind === "paragraph") {
    return <p className="commit-stack__paragraph">{block.text}</p>;
  }
  if (block.kind === "bullets") {
    return (
      <ul className="commit-stack__bullets">
        {block.items.map((item, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static, non-reordering bullet items
          <li key={index}>{item}</li>
        ))}
      </ul>
    );
  }
  return <pre className="commit-stack__pre">{block.text}</pre>;
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

function StackContents({
  row,
  sources,
  isOpen,
  onToggle,
}: {
  row: StackRow;
  sources: SourceLookup;
  isOpen: boolean;
  onToggle: () => void;
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

  const { added, removed } = countLines(files);
  const fileWord = files.length === 1 ? "1 file" : `${files.length} files`;

  return (
    <div className="commit-stack__contents">
      <button type="button" className="commit-stack__fold" onClick={onToggle}>
        <span className="commit-stack__fold-count">{fileWord}</span>
        <span className="commit-stack__fold-lines">
          <span className="commit-stack__added">+{added}</span>{" "}
          <span className="commit-stack__removed">-{removed}</span>
        </span>
        <span className="commit-stack__fold-caption">
          {contentsCaption(row.kind)}
        </span>
      </button>
      {isOpen && <DiffView files={files} sources={sources} />}
    </div>
  );
}
// ~/~ end
