// ~/~ begin <<docs/architecture/frontend/tour.md#frontend-view-tour-card>>[init]
import { type ReactNode, useState } from "react";
import type { SourceLookup, SyntaxToken } from "../../model/source";
import type {
  FileRow,
  Introduced,
  Span,
  TourCard,
  TourCommit,
  TourFile,
  TourIdea,
} from "../../model/tour";

/** The names a commit's code links to the commit that introduced them. */
export interface NameLinks {
  /** Matches any of them as a whole word, or null when there are none. */
  pattern: RegExp | null;
  byName: Map<string, Introduced>;
  commitNumber: (commitId: string) => number;
  preview: (
    name: Introduced,
  ) => { commit: TourCommit; file: TourFile; row: number } | null;
}

/** Rows drawn around what a card is about, so it reads in context. */
const AROUND = 3;
/** Rows one press of a fold's arrow shows. */
const STEP = 20;

/** `spans`, each widened by `by` and clipped to `length` rows, merged where
 *  they meet. */
export function visible(spans: Span[], by: number, length: number): Span[] {
  const sorted = spans
    .map(([a, b]): Span => [Math.max(0, a - by), Math.min(length - 1, b + by)])
    .sort((x, y) => x[0] - y[0]);
  const merged: [number, number][] = [];
  for (const [a, b] of sorted) {
    const last = merged.at(-1);
    if (last !== undefined && a <= last[1] + 1) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }
  return merged;
}

/** The tokens of one row, from the file each side is read from, or the
 *  patch's plain text while the file has not loaded. */
export function rowTokens(
  file: TourFile,
  row: FileRow,
  source: SourceLookup,
): SyntaxToken[] {
  const oldSide = row.kind === "removed";
  const blob = oldSide ? file.diff.oldBlob : file.diff.newBlob;
  const line = oldSide ? row.old : row.new;
  const lines =
    blob === null
      ? undefined
      : source(blob, oldSide ? file.oldPath : file.path)?.lines;
  const found = line === null ? undefined : lines?.[line - 1];
  return found ?? [{ text: row.code ?? "", kind: null }];
}

export function CodeRow({
  file,
  index,
  source,
  names,
  onName,
  className = "",
  onClick,
}: {
  file: TourFile;
  index: number;
  source: SourceLookup;
  names: NameLinks | null;
  onName: ((name: Introduced) => void) | null;
  className?: string;
  onClick?: () => void;
}) {
  const row = file.rows[index];
  if (row === undefined) return null;
  const sign = row.kind === "added" ? "+" : row.kind === "removed" ? "-" : "";
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a row is clicked with the mouse; the keyboard reads the card instead
    // biome-ignore lint/a11y/useKeyWithClickEvents: as above
    <div
      className={`tour-row tour-row--${row.kind} ${className}`}
      data-row={index}
      onClick={onClick}
    >
      <span className="tour-row__no">{row.old}</span>
      <span className="tour-row__no">{row.new}</span>
      <span className="tour-row__sign">{sign}</span>
      <code className="tour-row__code">
        {rowTokens(file, row, source).map((token, at) => (
          <Token
            // biome-ignore lint/suspicious/noArrayIndexKey: tokens of one line never move
            key={at}
            token={token}
            names={row.kind === "removed" ? null : names}
            onName={onName}
          />
        ))}
      </code>
    </div>
  );
}

function Token({
  token,
  names,
  onName,
}: {
  token: SyntaxToken;
  names: NameLinks | null;
  onName: ((name: Introduced) => void) | null;
}) {
  const className = token.kind === null ? undefined : `syntax--${token.kind}`;
  if (names?.pattern == null || onName === null) {
    return <span className={className}>{token.text}</span>;
  }
  const parts: ReactNode[] = [];
  let at = 0;
  for (const match of token.text.matchAll(names.pattern)) {
    const name = names.byName.get(match[0]);
    if (name === undefined || match.index === undefined) continue;
    parts.push(token.text.slice(at, match.index));
    parts.push(
      <NameLink key={match.index} name={name} names={names} onName={onName} />,
    );
    at = match.index + match[0].length;
  }
  if (parts.length === 0)
    return <span className={className}>{token.text}</span>;
  parts.push(token.text.slice(at));
  return <span className={className}>{parts}</span>;
}

function NameLink({
  name,
  names,
  onName,
}: {
  name: Introduced;
  names: NameLinks;
  onName: (name: Introduced) => void;
}) {
  const [peek, setPeek] = useState<DOMRect | null>(null);
  const preview = peek === null ? null : names.preview(name);
  const number = names.commitNumber(name.at.commitId);
  return (
    <button
      type="button"
      className="tour-name"
      onMouseEnter={(event) =>
        setPeek(event.currentTarget.getBoundingClientRect())
      }
      onMouseLeave={() => setPeek(null)}
      onFocus={(event) => setPeek(event.currentTarget.getBoundingClientRect())}
      onBlur={() => setPeek(null)}
      onClick={() => onName(name)}
    >
      {name.name}
      <sup className="tour-name__commit">{number}</sup>
      {peek !== null && preview !== null && (
        <span
          className="tour-pop"
          style={{
            left: Math.min(peek.left, window.innerWidth - 480),
            top:
              peek.bottom + 6 + 220 > window.innerHeight
                ? peek.top - 226
                : peek.bottom + 6,
          }}
        >
          <span className="tour-pop__head">
            <span className="tour-pill">{number}</span> introduced in{" "}
            {preview.file.path}
          </span>
          {preview.file.rows
            .slice(Math.max(0, preview.row - 2), preview.row + 6)
            .map((row, at) => {
              const index = Math.max(0, preview.row - 2) + at;
              return (
                <span
                  key={index}
                  className={`tour-row tour-row--${row.kind} ${index === preview.row ? "tour-row--aim" : ""}`}
                >
                  <span className="tour-row__no">{row.new ?? row.old}</span>
                  <code className="tour-row__code">{row.code ?? ""}</code>
                </span>
              );
            })}
          <span className="tour-pop__foot">
            used in {name.usedAt.length} places
          </span>
        </span>
      )}
    </button>
  );
}

function Fold({
  hidden,
  edge,
  onOpen,
}: {
  hidden: Span;
  /** Whether the fold runs to the top or the bottom of the file. */
  edge: "top" | "bottom" | null;
  onOpen: (span: Span) => void;
}) {
  const [a, b] = hidden;
  const count = b - a + 1;
  const button = (span: Span, label: string) => (
    <button
      type="button"
      className="tour-fold__button"
      onClick={() => onOpen(span)}
    >
      {label}
    </button>
  );
  return (
    <div className="tour-fold">
      <span>
        {count} unchanged {count === 1 ? "line" : "lines"}
        {edge === "top" ? " above" : edge === "bottom" ? " below" : ""}
      </span>
      {count <= STEP + 5 ? (
        button(hidden, "show")
      ) : (
        <>
          {edge !== "top" && button([a, a + STEP - 1], `${STEP} more down`)}
          {edge !== "bottom" && button([b - STEP + 1, b], `${STEP} more up`)}
          {button(hidden, "all")}
        </>
      )}
    </div>
  );
}

/** The commit's first card on its message, which opens the message; the
 *  others leave it folded, having said what to read in it. */
function firstMessage(commit: TourCommit): string | undefined {
  return commit.ideas
    .flatMap((idea) => idea.cards)
    .find((card) => card.kind === "message")?.key;
}

/** One card: the rows a stop is about with a few around, folds for the rest,
 *  and the guide's note; or the commit's message. */
export function CardView({
  card,
  commit,
  idea,
  current,
  opened,
  onOpen,
  source,
  names,
  onName,
}: {
  card: TourCard;
  commit: TourCommit;
  /** The idea to name on the card, in file order where it is not the
   *  heading above. */
  idea?: TourIdea | undefined;
  current: boolean;
  opened: Span[];
  onOpen: (span: Span) => void;
  source: SourceLookup;
  names: NameLinks;
  onName: (name: Introduced) => void;
}) {
  const className = `tour-card ${current ? "tour-card--current" : ""}`;
  const label = idea !== undefined && (
    <span className="tour-card__idea">{idea.title}</span>
  );
  const note = card.note !== "" && (
    <p className="tour-card__note">{card.note}</p>
  );

  if (card.kind === "message") {
    return (
      <article className={className} data-card={card.key}>
        <div className="tour-card__head">
          <span className="tour-card__path">commit message</span>
          {label}
        </div>
        {note}
        <details
          className="tour-message"
          open={firstMessage(commit) === card.key}
        >
          <summary>{commit.subject}</summary>
          <pre>{commit.description.slice(commit.subject.length).trim()}</pre>
        </details>
      </article>
    );
  }

  const file = commit.files.find((each) => each.path === card.path);
  if (file === undefined) return null;
  const length = file.rows.length;
  const shown = visible([...card.spans, ...opened], AROUND, length);
  const own = (index: number) =>
    card.spans.some(([a, b]) => a <= index && index <= b);
  const body: ReactNode[] = [];
  let next = 0;
  for (const [a, b] of shown) {
    if (a > next) {
      body.push(
        <Fold
          key={`fold-${next}`}
          hidden={[next, a - 1]}
          edge={next === 0 ? "top" : null}
          onOpen={onOpen}
        />,
      );
    }
    for (let index = a; index <= b; index++) {
      body.push(
        <CodeRow
          key={index}
          file={file}
          index={index}
          source={source}
          names={names}
          onName={onName}
          className={own(index) ? "tour-row--own" : ""}
        />,
      );
    }
    next = b + 1;
  }
  if (next < length) {
    body.push(
      <Fold
        key={`fold-${next}`}
        hidden={[next, length - 1]}
        edge="bottom"
        onOpen={onOpen}
      />,
    );
  }
  const first = file.rows[card.spans[0]?.[0] ?? 0];
  return (
    <article className={className} data-card={card.key}>
      <div className="tour-card__head">
        <span className="tour-card__path">{file.path}</span>
        <span className="tour-card__lines">
          {first?.new !== null && first?.new !== undefined
            ? `line ${first.new}`
            : ""}
        </span>
        {label}
      </div>
      {note}
      <div className="tour-card__code">{body}</div>
    </article>
  );
}
// ~/~ end
