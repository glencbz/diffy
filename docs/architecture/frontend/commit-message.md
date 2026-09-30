# Commit message

`CommitMessage` draws a commit's body under a subject something else has
already shown, cut down to its opening until the reader asks for the rest.
The [commit stack](commit-stack.md) on the pull request screen and each row
of [the local history diff](diff.md#interdiff-rows) show one.

## Reading a message

A commit body can run to any length, an explanation of what changed and why,
sometimes a bulleted inventory, sometimes a pasted command's output. Showing
all of it for every commit on screen would make a stack of them as long as
the sum of every commit's rationale, which defeats scrolling it as one stack
in the first place. Showing none of it hides the one thing that tells a
reader whether a commit is worth opening at all. `opening` is the middle
ground, a short prefix that carries the "why" without carrying the rest.

```ts
//| id: frontend-view-commit-message
//| file: src/frontend/views/CommitMessage.tsx
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
//| id: frontend-view-commit-message

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
places, weight, prose, and a muted footer, so the view needs them apart
rather than as one string to re-split on every render.

```ts
//| id: frontend-view-commit-message

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

The subject is not drawn here. Whatever holds the message already shows it,
in a stack row's spine or a comparison header's commit label, and a second
copy right under it would only push the body down. Trailers wait until the
message is expanded: they say who else wrote the commit, not what it does.

Whether a message is expanded belongs to the caller, since only the caller
knows what a message is a message of and how long that choice should last.

```tsx
//| id: frontend-view-commit-message

export function CommitMessage({
  description,
  className,
  isExpanded,
  onExpand,
}: {
  description: string;
  /** The box the caller holds the message in. */
  className: string;
  isExpanded: boolean;
  onExpand: () => void;
}) {
  const { body, trailers } = splitMessage(description);
  const { text, rest } = opening(body);
  const blocks = messageBlocks(isExpanded ? body : text);

  return (
    <div className={className}>
      {blocks.map((block, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static, non-reordering message blocks
        <MessageBlockView key={index} block={block} />
      ))}
      {rest > 0 && (
        <button
          type="button"
          className="commit-message__expand"
          onClick={onExpand}
        >
          {isExpanded
            ? "fold the message"
            : `read the rest of the message, ${rest} lines`}
        </button>
      )}
      {isExpanded && trailers !== "" && (
        <p className="commit-message__trailers">{trailers}</p>
      )}
    </div>
  );
}

function MessageBlockView({ block }: { block: MessageBlock }) {
  if (block.kind === "paragraph") {
    return <p className="commit-message__paragraph">{block.text}</p>;
  }
  if (block.kind === "bullets") {
    return (
      <ul className="commit-message__bullets">
        {block.items.map((item, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static, non-reordering bullet items
          <li key={index}>{item}</li>
        ))}
      </ul>
    );
  }
  return <pre className="commit-message__pre">{block.text}</pre>;
}
```

## Styling

The message styles what is inside it and leaves its box, the padding and
the measure around it, to the caller through `className`. A commit stack
row and a local diff row each pad their contents their own way, and the
message has to line up with the rest of its row.

```css
/*| id: design-commit-message
@layer components {
  .commit-message__paragraph {
    margin: 0 0 var(--space-3);
  }

  .commit-message__bullets {
    margin: 0 0 var(--space-3);
    padding-left: var(--space-6);
  }

  .commit-message__pre {
    padding: var(--space-3);
    overflow-x: auto;
    font-family: var(--font-mono);
    font-size: var(--text-size-small);
    background: var(--surface-sunken);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius);
  }

  .commit-message__expand {
    padding: 0;
    font: inherit;
    color: var(--accent);
    cursor: pointer;
    background: transparent;
    border: none;
  }

  .commit-message__trailers {
    margin: var(--space-3) 0 0;
    font-size: var(--text-size-small);
    color: var(--text-faint);
    white-space: pre-line;
  }
}
```

## Tests

```ts
//| id: frontend-view-commit-message-test
//| file: src/frontend/views/CommitMessage.test.ts
import { describe, expect, test } from "bun:test";
import { messageBlocks, opening, splitMessage } from "./CommitMessage";

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
```
