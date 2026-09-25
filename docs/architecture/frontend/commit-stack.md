# Commit stack

A pull request read as one squashed patch, one head against another
flattened into a single diff, throws away which commit each hunk came from. `CommitStack` replaces it with
one section per commit, read top to bottom the way the branch itself reads.

Every commit in the stack needs to be seen. Only some need to be read in
full, so a section shows its commit's message by default and keeps its
contents folded shut until asked for. A reader scrolling the whole stack
sees what every commit is and opens only the ones that matter to them.

## Message helpers

A commit body can run to any length, an explanation of what changed and why,
sometimes a bulleted inventory, sometimes a pasted command's output. Showing
all of it for every commit in the stack would make the stack as long as the
sum of every commit's rationale, which defeats scrolling it as one stack in
the first place. Showing none of it hides the one thing that tells a reader
whether a commit is worth opening at all. `opening` is the middle ground, a
short prefix that carries the "why" without carrying the rest.

```ts
//| id: frontend-view-commit-stack
//| file: src/frontend/views/CommitStack.tsx
import { type ReactElement, useEffect, useRef } from "react";
import type { FileDiff, GitCommit } from "../api";
import type { AsyncState } from "../state/asyncState";
import type { SourceLookup } from "../state/source";
import { type DiffLinks, DiffView } from "./DiffView";

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
```

A body's paragraphs and its bulleted inventory are two different shapes and
read differently once the window narrows. `messageBlocks` keeps that shape
as data instead of flattening it to one string, so the view can reflow a
paragraph while leaving a bullet list's items and an indented block's lines
alone.

```ts
//| id: frontend-view-commit-stack

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
```

A commit's subject, its body, and its trailers are shown in three different
places, weight, prose, and a muted footer, so a section needs them apart
rather than as one string to re-split on every render.

```ts
//| id: frontend-view-commit-stack

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
```

## The view

A row folds its contents shut because opening every commit's diff by
default is the same problem the message solves the other way. The message
stays visible, cut down to its opening, because it is what tells a reader
whether the commit is worth a second look at all. The diff stays hidden
until asked for, because reading it is a decision a reader makes commit by
commit, not something the stack should spend their scroll on for free.

A dropped or an unchanged row carries nothing to decide. One commit is gone
from the branch, the other made it through untouched, and neither is asking
for a read. Both collapse to their spine and one line saying which of the
two it is, with a control that opens the row back up for a reader who wants
it anyway.

A reworded row always has contents to show. `jj interdiff` reports a changed
message as a synthetic `JJ-COMMIT-DESCRIPTION` file, so the row's contents
are the old message against the new one, captioned as a change like any
other.

Picking a commit in the graph pane scrolls its row to the top of the stack.
A highlight on a row the reader cannot see answers nothing. Picking the same
commit again scrolls it back, since a reader who has read on past it and
clicks it a second time is asking to go back to it. `reveal` counts the
times the reader asked to be taken to the current row, so the second click
changes something the row can react to even though `current` did not change.
A row that becomes current any other way, by a click on one of its lines, is
already in front of the reader and stays where it is.

Each row's diff links its files and lines to [the address](address.md), and
`links` says where each one goes. A row whose current file or line is linked
leaves the scrolling to its diff, which brings that file or line into view
itself. Scrolling the row to the top first would be undone at once, or worse,
land after it.

A row's spine sticks to the top while the row is on screen, and so does the
header of each file in its diff, so the file headers have to stop below the
spine instead of covering it. The spine wraps on a phone and grows with the
text size setting, so its height is measured rather than written down, and
the row hands it to its diff as `--diff-sticky-top`.

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
}) {
  const section = useRef<HTMLElement>(null);
  const diffScrolls = links.selected !== null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: reveal is the trigger; becoming current by a click in the diff must not scroll
  useEffect(() => {
    if (isCurrent && !diffScrolls) {
      section.current?.scrollIntoView({ block: "start" });
    }
  }, [reveal]);

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
            links={links}
            reveal={reveal}
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
  links,
  reveal,
}: {
  row: StackRow;
  sources: SourceLookup;
  isOpen: boolean;
  onToggle: () => void;
  links: DiffLinks;
  reveal: number;
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
      {isOpen && (
        <DiffView
          files={files}
          sources={sources}
          scope={row.commit.commitId}
          links={links}
          reveal={reveal}
        />
      )}
    </div>
  );
}
```

## Styling

The spine sticks to the top of the pane so a reader who has scrolled deep
into an open patch still sees whose commit they are reading. Nothing else on
a row says that once the spine has scrolled off, and a patch can run well
past one screen.

A dropped commit's subject is struck through. Muted colour alone reads the
same as "unremarkable," which is what an unchanged row wants it to say, and
a dropped row wants the opposite, that this is gone. The strike is the one
mark that reads as gone before a caption has to say so.

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

  .commit-stack__message {
    max-width: 72ch;
    padding: var(--space-3) var(--space-5);
  }

  .commit-stack__paragraph {
    margin: 0 0 var(--space-3);
  }

  .commit-stack__bullets {
    margin: 0 0 var(--space-3);
    padding-left: var(--space-6);
  }

  .commit-stack__pre {
    padding: var(--space-3);
    overflow-x: auto;
    font-family: var(--font-mono);
    font-size: var(--text-size-small);
    background: var(--surface-sunken);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius);
  }

  .commit-stack__expand {
    padding: 0;
    font: inherit;
    color: var(--accent);
    cursor: pointer;
    background: transparent;
    border: none;
  }

  .commit-stack__trailers {
    margin: var(--space-3) 0 0;
    font-size: var(--text-size-small);
    color: var(--text-faint);
    white-space: pre-line;
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

  .commit-stack__added {
    color: var(--diff-added);
  }

  .commit-stack__removed {
    color: var(--diff-removed);
  }
}
```

Below [the thousand-pixel line every narrow rule in this app shares](layout.md),
the fold caption gives up its room the way a narrow field elsewhere in the
app does, and the 72ch cap on the message comes off since the pane itself is
already narrower than that measure and the cap would only add a second limit
to the one the pane already imposes.

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

The pure helpers are what carries the logic here, so they are what gets
pinned, the same way `messageBlocks` and `splitMessage` are tested without
rendering anything, the pattern `PairedGraph.test.ts` and `CommitGraph.test.ts`
already set for this app.

```ts
//| id: frontend-view-commit-stack-test
//| file: src/frontend/views/CommitStack.test.ts
import { describe, expect, test } from "bun:test";
import type { FileDiff } from "../api";
import {
  countLines,
  messageBlocks,
  opening,
  splitMessage,
} from "./CommitStack";

describe("opening", () => {
  test("keeps a short first paragraph whole", () => {
    // arrange
    const body = "one\ntwo\n\nthree\nfour";

    // act
    const { text, rest } = opening(body);

    // assert
    expect(text).toBe("one\ntwo");
    expect(rest).toBe(2);
  });

  test("caps a long first paragraph at six lines", () => {
    // arrange
    const body = "1\n2\n3\n4\n5\n6\n7\n8";

    // act
    const { text, rest } = opening(body);

    // assert
    expect(text).toBe("1\n2\n3\n4\n5\n6");
    expect(rest).toBe(2);
  });

  test("takes every line when there is no blank line at all", () => {
    // arrange
    const body = "1\n2\n3";

    // act
    const { text, rest } = opening(body);

    // assert
    expect(text).toBe("1\n2\n3");
    expect(rest).toBe(0);
  });

  test("counts only the lines with text in what it leaves out", () => {
    // arrange
    const body = "a\n\nb\nc\nd";

    // act
    const { rest } = opening(body);

    // assert
    expect(rest).toBe(3);
  });

  test("leaves nothing to read for a commit with only a subject", () => {
    // arrange
    const body = "";

    // act
    const { text, rest } = opening(body);

    // assert
    expect(text).toBe("");
    expect(rest).toBe(0);
  });
});

describe("messageBlocks", () => {
  test("collapses a paragraph's line breaks to single spaces", () => {
    // arrange
    const body = "this wraps\nacross two lines";

    // act
    const blocks = messageBlocks(body);

    // assert
    expect(blocks).toEqual([
      { kind: "paragraph", text: "this wraps across two lines" },
    ]);
  });

  test("folds a wrapped continuation line into the bullet above it", () => {
    // arrange
    const body = "- first item\n  still the first item\n- second item";

    // act
    const blocks = messageBlocks(body);

    // assert
    expect(blocks).toEqual([
      {
        kind: "bullets",
        items: ["first item still the first item", "second item"],
      },
    ]);
  });

  test("keeps an indented block verbatim", () => {
    // arrange
    const body = "  $ some command\n  output line";

    // act
    const blocks = messageBlocks(body);

    // assert
    expect(blocks).toEqual([
      { kind: "pre", text: "  $ some command\n  output line" },
    ]);
  });
});

describe("splitMessage", () => {
  test("peels a co-authored-by trailer off the end of the body", () => {
    // arrange
    const description =
      "subject line\n\nbody line one\n\nCo-authored-by: Ada <ada@example.com>";

    // act
    const { subject, body, trailers } = splitMessage(description);

    // assert
    expect(subject).toBe("subject line");
    expect(body).toBe("body line one");
    expect(trailers).toBe("Co-authored-by: Ada <ada@example.com>");
  });
});

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
