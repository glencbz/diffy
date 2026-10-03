// ~/~ begin <<docs/architecture/frontend/diff.md#frontend-view-diff-patch-line>>[init]
import type { LineAnchor } from "../../../model/review";
import type { PaintedToken } from "../../../model/words";
import type { CodeKind, DrawnLine, Side } from "./drawnLines";
import { type FileLinks, follow } from "./links";

/** A `<button>` when the line is a line of the file, a `<div>` otherwise. A
 *  read-only diff passes no `onOpenComposer`, which makes every line static,
 *  and a read-only diff with `links` makes the gutter number of every
 *  after-side line a link to it. In a column a line is numbered by that
 *  column's side, and opens the composer only in the column of the side it
 *  is anchored to, so each line is commented on from one place. */
export function PatchLine({
  line,
  side,
  onOpenComposer,
  links,
}: {
  line: Exclude<DrawnLine, { kind: "gap" }>;
  side?: Side;
  onOpenComposer?: (anchor: LineAnchor) => void;
  links?: FileLinks;
}) {
  const anchor =
    "anchor" in line && (side === undefined || line.anchor.side === side)
      ? line.anchor
      : null;
  const afterLine = anchor?.side === "after" ? anchor.line : null;
  const number =
    side === "before" && "beforeLine" in line ? line.beforeLine : afterLine;
  const linked =
    afterLine !== null && links !== undefined && onOpenComposer === undefined;
  const body = (
    <>
      {linked ? (
        <a
          href={links.href(afterLine)}
          onClick={(event) => follow(event, () => links.onFollow(afterLine))}
          className="diff-line__gutter diff-line__anchor"
        >
          {afterLine}
        </a>
      ) : (
        <span className="diff-line__gutter">{number ?? ""}</span>
      )}
      {"text" in line ? (
        <span className={`diff-line__text--${line.kind}`}>
          {line.text === "" ? " " : line.text}
        </span>
      ) : (
        <span>
          <span className="diff-line__sign">{SIGNS[line.kind]}</span>
          {line.tokens.map((token, index) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: static, non-reordering tokens
              key={index}
              className={tokenClass(token)}
            >
              {token.text}
            </span>
          ))}
        </span>
      )}
    </>
  );
  const selected =
    afterLine !== null && links?.selected?.line === afterLine
      ? " diff-line--selected"
      : "";
  const column = side === undefined ? "" : ` diff-line--${side}`;
  const className = `diff-line diff-line--${line.kind}${column}${selected}`;

  if (anchor === null || onOpenComposer === undefined) {
    return <div className={className}>{body}</div>;
  }

  return (
    <button
      type="button"
      onClick={() => onOpenComposer(anchor)}
      className={`${className} diff-line--interactive`}
    >
      {body}
    </button>
  );
}

/** The other column's half of a row whose line is only on one side. */
export function EmptyCell({ side }: { side: Side }) {
  return <div className={`diff-line diff-line--${side} diff-line--empty`} />;
}

function tokenClass(token: PaintedToken): string | undefined {
  const classes = [
    token.kind === null ? null : `syntax--${token.kind}`,
    token.changed ? "diff-line__changed" : null,
  ].filter((name) => name !== null);
  return classes.length === 0 ? undefined : classes.join(" ");
}

const SIGNS: Record<CodeKind, string> = {
  context: " ",
  added: "+",
  removed: "-",
};
// ~/~ end
