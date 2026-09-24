// ~/~ begin <<docs/architecture/frontend/paired-graph.md#frontend-view-paired-graph>>[init]
import { Fragment, type RefObject, useRef, useState } from "react";
import type { GitCommit } from "../api";
import type { Pairing, Side, Slot } from "../state/pairing";

export type RowKind = "added" | "dropped" | "paired";

/** What shape a row draws. Never tries to say whether a paired commit was
 *  amended or is byte-identical; that needs the diff, which this pane does
 *  not fetch. */
export function rowKind(slot: Slot): RowKind {
  if (slot.left === null) return "added";
  if (slot.right === null) return "dropped";
  return "paired";
}

const RAIL_MARK: Record<RowKind, string> = {
  added: "+",
  dropped: "−",
  paired: "~",
};

/** What the mark on the rail means, for a reader who cannot see it. */
const RAIL_WORD: Record<RowKind, string> = {
  added: "only in the newer version",
  dropped: "only in the older version",
  paired: "in both versions",
};

interface Drag {
  side: Side;
  index: number;
}

function commitById(commits: GitCommit[], id: string | null): GitCommit | null {
  if (id === null) return null;
  return commits.find((commit) => commit.commitId === id) ?? null;
}

export interface PairedGraphProps {
  /** The older version's commits, oldest first. */
  before: GitCommit[];
  /** The newer version's commits, oldest first. */
  after: GitCommit[];
  pairing: Pairing;
  beforeLabel: string;
  afterLabel: string;
  /** The commit the diff pane is showing, or null. */
  current: string | null;
  onSelect: (commitId: string) => void;
}

export function PairedGraph({
  before,
  after,
  pairing,
  beforeLabel,
  afterLabel,
  current,
  onSelect,
}: PairedGraphProps) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const refocus = useRef<string | null>(null);

  function handleNudge(side: Side, index: number, step: -1 | 1) {
    const id = pairing.slots[index]?.[side] ?? null;
    refocus.current = id === null ? null : `${id}${step}`;
    pairing.nudge(side, index, step);
  }

  function handleDrop(side: Side, to: number) {
    if (drag !== null && drag.side === side) pairing.move(side, drag.index, to);
    setDrag(null);
  }

  return (
    <div className="paired-graph">
      <span className="paired-graph__label">{beforeLabel}</span>
      <span className="paired-graph__rail" aria-hidden="true" />
      <span className="paired-graph__label">{afterLabel}</span>
      {pairing.slots.map((slot, index) => {
        const kind = rowKind(slot);
        const isCurrent =
          current !== null && (slot.left === current || slot.right === current);
        return (
          <Fragment key={`${slot.left ?? ""}:${slot.right ?? ""}`}>
            <Lane
              side="left"
              index={index}
              commit={commitById(before, slot.left)}
              isCurrent={isCurrent}
              drag={drag}
              legalTargets={pairing.legalTargets}
              onSelect={onSelect}
              onNudge={handleNudge}
              refocus={refocus}
              onDragStart={setDrag}
              onDragEnd={() => setDrag(null)}
              onDrop={handleDrop}
            />
            <span
              className={`paired-graph__rail paired-graph__rail--${kind}`}
              role="img"
              aria-label={RAIL_WORD[kind]}
            >
              {RAIL_MARK[kind]}
            </span>
            <Lane
              side="right"
              index={index}
              commit={commitById(after, slot.right)}
              isCurrent={isCurrent}
              drag={drag}
              legalTargets={pairing.legalTargets}
              onSelect={onSelect}
              onNudge={handleNudge}
              refocus={refocus}
              onDragStart={setDrag}
              onDragEnd={() => setDrag(null)}
              onDrop={handleDrop}
            />
          </Fragment>
        );
      })}
      <div className="paired-graph__footer">
        <button
          type="button"
          className="paired-graph__reset"
          onClick={pairing.reset}
          disabled={!pairing.edited}
        >
          reset the pairing
        </button>
      </div>
    </div>
  );
}

function Lane({
  side,
  index,
  commit,
  isCurrent,
  drag,
  legalTargets,
  onSelect,
  onNudge,
  refocus,
  onDragStart,
  onDragEnd,
  onDrop,
}: {
  side: Side;
  index: number;
  commit: GitCommit | null;
  isCurrent: boolean;
  drag: Drag | null;
  legalTargets: (side: Side, index: number) => number[];
  onSelect: (commitId: string) => void;
  onNudge: (side: Side, index: number, step: -1 | 1) => void;
  refocus: RefObject<string | null>;
  onDragStart: (drag: Drag) => void;
  onDragEnd: () => void;
  onDrop: (side: Side, to: number) => void;
}) {
  if (commit !== null) {
    return (
      <Card
        side={side}
        index={index}
        commit={commit}
        isCurrent={isCurrent}
        onSelect={onSelect}
        onNudge={onNudge}
        refocus={refocus}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      />
    );
  }

  const isLegal =
    drag !== null &&
    drag.side === side &&
    legalTargets(drag.side, drag.index).includes(index);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: HTML5 drag-and-drop has no ARIA role; the nudge buttons are the accessible path for the same move
    <div
      className={
        isLegal
          ? "paired-graph__blank paired-graph__blank--legal"
          : "paired-graph__blank"
      }
      onDragOver={isLegal ? (event) => event.preventDefault() : undefined}
      onDrop={isLegal ? () => onDrop(side, index) : undefined}
    />
  );
}

function Card({
  side,
  index,
  commit,
  isCurrent,
  onSelect,
  onNudge,
  refocus,
  onDragStart,
  onDragEnd,
}: {
  side: Side;
  index: number;
  commit: GitCommit;
  isCurrent: boolean;
  onSelect: (commitId: string) => void;
  onNudge: (side: Side, index: number, step: -1 | 1) => void;
  refocus: RefObject<string | null>;
  onDragStart: (drag: Drag) => void;
  onDragEnd: () => void;
}) {
  const shortId = commit.commitId.slice(0, 8);
  const subject = commit.description.split("\n")[0] ?? "";
  const takeFocus = (step: -1 | 1) => (button: HTMLButtonElement | null) => {
    if (button !== null && refocus.current === `${commit.commitId}${step}`) {
      refocus.current = null;
      button.focus();
    }
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: draggable card; the ↑/↓ buttons inside it are the accessible path for the same move
    <div
      className={
        isCurrent
          ? "paired-graph__card paired-graph__card--current"
          : "paired-graph__card"
      }
      draggable
      onDragStart={() => onDragStart({ side, index })}
      onDragEnd={onDragEnd}
    >
      <button
        type="button"
        className="paired-graph__card-body"
        onClick={() => onSelect(commit.commitId)}
      >
        <span className="paired-graph__card-id">{shortId}</span>
        <span className="paired-graph__card-subject">{subject}</span>
      </button>
      <span className="paired-graph__card-nudges">
        <button
          type="button"
          title="move this commit up a row"
          className="paired-graph__nudge"
          ref={takeFocus(-1)}
          onClick={() => onNudge(side, index, -1)}
        >
          ↑
        </button>
        <button
          type="button"
          title="move this commit down a row"
          className="paired-graph__nudge"
          ref={takeFocus(1)}
          onClick={() => onNudge(side, index, 1)}
        >
          ↓
        </button>
      </span>
    </div>
  );
}
// ~/~ end
