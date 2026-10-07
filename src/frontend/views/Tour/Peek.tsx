// ~/~ begin <<docs/architecture/frontend/tour.md#frontend-view-tour-peek>>[init]
import { useEffect, useRef } from "react";
import type { SourceLookup } from "../../model/source";
import type { Span, TourCard, TourCommit } from "../../model/tour";
import { CodeRow, visible } from "./CardView";

/** The whole file the current card is in, with the card's rows marked. A
 *  click on any other row widens the card to reach it. */
export function Peek({
  commit,
  card,
  opened,
  onPull,
  source,
}: {
  commit: TourCommit;
  card: Extract<TourCard, { kind: "file" }>;
  opened: Span[];
  onPull: (span: Span) => void;
  source: SourceLookup;
}) {
  const file = commit.files.find((each) => each.path === card.path);
  const ref = useRef<HTMLDivElement>(null);
  const shown =
    file === undefined
      ? []
      : visible([...card.spans, ...opened], 3, file.rows.length);
  const first = shown[0]?.[0] ?? 0;

  // biome-ignore lint/correctness/useExhaustiveDependencies: follows the card, not each widening of it
  useEffect(() => {
    ref.current
      ?.querySelector(`[data-row="${first}"]`)
      ?.scrollIntoView({ block: "center" });
  }, [card.key, file]);

  if (file === undefined) return null;
  const inCard = (index: number) =>
    shown.some(([a, b]) => a <= index && index <= b);
  const pull = (index: number) => {
    const before = shown.filter(([a]) => a <= index).at(-1);
    const after = shown.find(([a]) => a > index);
    if (
      before !== undefined &&
      (after === undefined || index - before[1] <= after[0] - index)
    ) {
      onPull([before[1], index]);
    } else if (after !== undefined) {
      onPull([index, after[0]]);
    }
  };

  return (
    <div className="tour-peek">
      <p className="tour-setup__label">
        {file.path}, {file.rows.length} rows. Click a row to bring it into the
        card.
      </p>
      <div className="tour-peek__rows" ref={ref}>
        {file.rows.map((_row, index) => (
          <CodeRow
            // biome-ignore lint/suspicious/noArrayIndexKey: a file's rows never move
            key={index}
            file={file}
            index={index}
            source={source}
            className={
              inCard(index) ? "tour-row--in-card" : "tour-row--pullable"
            }
            onClick={inCard(index) ? undefined : () => pull(index)}
          />
        ))}
      </div>
    </div>
  );
}
// ~/~ end
