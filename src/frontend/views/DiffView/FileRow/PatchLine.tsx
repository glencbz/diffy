// ~/~ begin <<docs/architecture/frontend/diff.md#frontend-view-diff-patch-line>>[init]
import type { LineAnchor } from "../../../model/review";
import type { PaintedToken } from "../../../model/words";
import type { CodeKind, DrawnLine, Side } from "./drawnLines";
import { type FileLinks, follow } from "./links";

/** What reaching for a line does. */
export type LineAction =
  /** Nothing: the line is static. */
  | { kind: "none" }
  /** The gutter number of an after-side line links to it. */
  | { kind: "link"; links: FileLinks }
  /** The line is a `<button>` that opens the composer on it. */
  | { kind: "comment"; onOpenComposer: (anchor: LineAnchor) => void };

/** One line of a patch. In a column a line is numbered by that column's
 *  side, and opens the composer only in the column of the side it is
 *  anchored to, so each line is commented on from one place. */
export function PatchLine({
  line,
  side,
  action,
  selected,
}: {
  line: Exclude<DrawnLine, { kind: "gap" }>;
  side?: Side;
  action: LineAction;
  /** The after-side line the address names, if any. */
  selected: number | null;
}) {
  const anchor =
    "anchor" in line && (side === undefined || line.anchor.side === side)
      ? line.anchor
      : null;
  const afterLine = anchor?.side === "after" ? anchor.line : null;
  const number =
    side === "before" && "beforeLine" in line ? line.beforeLine : afterLine;
  const gutter = <span className="diff-line__gutter">{number ?? ""}</span>;
  const text =
    "text" in line ? (
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
    );
  const marked =
    afterLine !== null && selected === afterLine ? " diff-line--selected" : "";
  const column = side === undefined ? "" : ` diff-line--${side}`;
  const className = `diff-line diff-line--${line.kind}${column}${marked}`;

  switch (action.kind) {
    case "none":
      return (
        <div className={className}>
          {gutter}
          {text}
        </div>
      );
    case "link": {
      const { links } = action;
      return (
        <div className={className}>
          {afterLine === null ? (
            gutter
          ) : (
            <a
              href={links.href(afterLine)}
              onClick={(event) =>
                follow(event, () => links.onFollow(afterLine))
              }
              className="diff-line__gutter diff-line__anchor"
            >
              {afterLine}
            </a>
          )}
          {text}
        </div>
      );
    }
    case "comment": {
      const { onOpenComposer } = action;
      return anchor === null ? (
        <div className={className}>
          {gutter}
          {text}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => onOpenComposer(anchor)}
          className={`${className} diff-line--interactive`}
        >
          {gutter}
          {text}
        </button>
      );
    }
  }
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
