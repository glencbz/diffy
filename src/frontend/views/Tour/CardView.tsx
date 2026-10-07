// ~/~ begin <<docs/architecture/frontend/tour.md#frontend-view-tour-card>>[init]
import type { ReactNode } from "react";
import type { SourceLookup, SyntaxToken } from "../../model/source";
import type {
  FileRow,
  Span,
  TourCard,
  TourCommit,
  TourFile,
  TourIdea,
} from "../../model/tour";

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
  className = "",
  onClick,
}: {
  file: TourFile;
  index: number;
  source: SourceLookup;
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
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: tokens of one line never move
            key={at}
            className={
              token.kind === null ? undefined : `syntax--${token.kind}`
            }
          >
            {token.text}
          </span>
        ))}
      </code>
    </div>
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
