// ~/~ begin <<docs/architecture/frontend/diff.md#frontend-view-diff-patch-line>>[init]

import type { ReactNode } from "react";
import type { LineAnchor } from "../../../model/review";
import type { PaintedToken } from "../../../model/words";
import {
  anchorKey,
  type CodeKind,
  type DrawnLine,
  type Side,
} from "./drawnLines";
import { type FileLinks, follow } from "./links";

/** What reaching for a line does. */
export type LineAction =
  /** Nothing: the line is static. */
  | { kind: "none" }
  /** The gutter number of an after-side line links to it. */
  | { kind: "link"; links: FileLinks }
  /** The gutter is a `<button>` that opens the composer on the line, and
   *  so is a click on the rest of the row. */
  | { kind: "comment"; onOpenComposer: (anchor: LineAnchor) => void };

/** One line of a patch. In a column a line is numbered by that column's
 *  side, and opens the composer only in the column of the side it is
 *  anchored to, so each line is commented on from one place. */
export function PatchLine({
  line,
  side,
  action,
  selected,
  decor,
}: {
  line: Exclude<DrawnLine, { kind: "gap" }>;
  side?: Side;
  action: LineAction;
  /** The after-side line the address names, if any. */
  selected: number | null;
  /** What a layer over the diff adds to the line: classes, and a marker in
   *  place of its sign. */
  decor?: {
    className: string | null;
    marker: ReactNode;
    token?: (text: string) => ReactNode;
  };
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
        <span className="diff-line__sign">
          {decor?.marker ?? SIGNS[line.kind]}
        </span>
        {line.tokens.map((token, index) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: static, non-reordering tokens
            key={index}
            className={tokenClass(token)}
          >
            {decor?.token?.(token.text) ?? token.text}
          </span>
        ))}
      </span>
    );
  const marked =
    afterLine !== null && selected === afterLine ? " diff-line--selected" : "";
  const column = side === undefined ? "" : ` diff-line--${side}`;
  const decorated = decor?.className == null ? "" : ` ${decor.className}`;
  const className = `diff-line diff-line--${line.kind}${column}${marked}${decorated}`;
  const at = anchor === null ? undefined : anchorKey(anchor);

  switch (action.kind) {
    case "none":
      return (
        <div className={className} data-anchor={at}>
          {gutter}
          {text}
        </div>
      );
    case "link": {
      const { links } = action;
      return (
        <div className={className} data-anchor={at}>
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
        <div className={className} data-anchor={at}>
          {gutter}
          {text}
        </div>
      ) : (
        // biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: the gutter button is the keyboard path
        <div
          onClick={() => {
            if (window.getSelection()?.isCollapsed === false) return;
            onOpenComposer(anchor);
          }}
          className={`${className} diff-line--interactive`}
          data-anchor={at}
        >
          <button
            type="button"
            aria-label={`comment on ${anchor.side} line ${anchor.line}`}
            onClick={(event) => {
              event.stopPropagation();
              onOpenComposer(anchor);
            }}
            className="diff-line__gutter diff-line__comment"
          >
            {number ?? ""}
          </button>
          {text}
        </div>
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
