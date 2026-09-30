// ~/~ begin <<docs/architecture/frontend/commit-message.md#frontend-view-commit-message>>[init]
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
// ~/~ begin <<docs/architecture/frontend/commit-message.md#frontend-view-commit-message>>[1]

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
// ~/~ begin <<docs/architecture/frontend/commit-message.md#frontend-view-commit-message>>[2]

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
// ~/~ begin <<docs/architecture/frontend/commit-message.md#frontend-view-commit-message>>[3]

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
// ~/~ end
