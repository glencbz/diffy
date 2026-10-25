// ~/~ begin <<docs/architecture/frontend/panels.md#frontend-view-panels-split>>[init]
import { type ReactNode, useRef, useState } from "react";
import type { Split } from "../../model/panels";

/** What a drag always leaves either side of a divider, in pixels. */
const LEAST = 80;

export function SplitView({
  split,
  dir,
  folded,
  onSizes,
  children,
}: {
  split: Split;
  /** The split's own direction, or stacked on a narrow screen. */
  dir: Split["dir"];
  folded: boolean[];
  onSizes: (sizes: (number | null)[]) => void;
  children: ReactNode[];
}) {
  const box = useRef<HTMLDivElement>(null);
  const [live, setLive] = useState<(number | null)[] | null>(null);
  const sizes = live ?? split.sizes;
  const drag = (index: number) => (event: React.PointerEvent) => {
    const cells = [...(box.current?.children ?? [])] as HTMLElement[];
    if (cells.length !== children.length) return;
    event.preventDefault();
    const along = (rect: DOMRect) => (dir === "row" ? rect.width : rect.height);
    const from = cells.map((cell) => along(cell.getBoundingClientRect()));
    const start = dir === "row" ? event.clientX : event.clientY;
    let last: (number | null)[] = sizes;
    const move = (moved: PointerEvent) => {
      const by = (dir === "row" ? moved.clientX : moved.clientY) - start;
      const a = (from[index] ?? 0) + by;
      const b = (from[index + 1] ?? 0) - by;
      if (a < LEAST || b < LEAST) return;
      last = from.map((size, at) =>
        folded[at]
          ? (sizes[at] ?? null)
          : at === index
            ? a
            : at === index + 1
              ? b
              : size,
      );
      setLive(last);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setLive(null);
      if (last !== sizes) onSizes(last);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const natural = (index: number) =>
    (sizes[index] ?? null) === null || (folded[index] ?? false);
  // Flex hands out only the part of the room its grows add up to, so the
  // shares left once a child folds are scaled back up to the whole.
  const shared = sizes.reduce<number>(
    (sum, size, index) => (natural(index) ? sum : sum + (size ?? 0)),
    0,
  );
  return (
    <div ref={box} className={`panel-split panel-split--${dir}`}>
      {children.map((child, index) => {
        const size = sizes[index] ?? null;
        return (
          <div
            key={split.children[index]?.id}
            className={`panel-split__cell${natural(index) ? " panel-split__cell--natural" : ""}`}
            style={
              natural(index) || size === null
                ? undefined
                : { flex: `${size / shared} 1 0` }
            }
          >
            {child}
            {index < children.length - 1 &&
              !folded[index] &&
              !folded[index + 1] && (
                <div
                  className={`panel-split__handle panel-split__handle--${dir}`}
                  onPointerDown={drag(index)}
                />
              )}
          </div>
        );
      })}
    </div>
  );
}
// ~/~ end
