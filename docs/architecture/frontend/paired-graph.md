# Paired graph

`PairedGraph` draws `usePairing`'s `Slot[]` as two lanes with a rail between
them, and the controls to correct a slot the heuristic guessed wrong. A slot
missing one side is drawn as a gap in that lane, so the absence reads from
the shape of the page rather than a caption.

## Row shape

The rail marks only a row's shape: `+` added, `−` dropped, `~` paired. Whether
a paired commit changed lives in its diff, and
[the diff row says so](diff.md#interdiff-rows) once it is fetched; a cheaper
guess here would disagree with it.

## Moving a card

Cards drag between blanks on their own side, and a blank highlights only when
`pairing.legalTargets` allows it, the same rule `nudge` and `move` enforce.
The `↑`/`↓` buttons do the same move for keyboards and touch screens, where a
native drag is unreachable or fights the scroll.

```tsx
//| id: frontend-view-paired-graph
//| file: src/frontend/views/PairedGraph.tsx
import { Fragment, type RefObject, useRef, useState } from "react";
import type { GitCommit } from "../model/history";
import type { Pairing, Side, Slot } from "../model/pairing";

export type RowKind = "added" | "dropped" | "paired";

/** What shape a row draws. Never tries to say whether a paired commit was
 *  amended or is byte-identical; that needs the diff, which this pane does
 *  not fetch. */
function rowKind(slot: Slot): RowKind {
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

  // A nudge remounts the card it moved and drops focus; the arrow that was
  // pressed takes it back as it mounts, so holding a key keeps walking.
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
```

## Styling

A blank is a dashed, hatched gap; during a drag a legal one gets a solid
accent border. Below [1000px](layout.md) the lanes stay side by side, since
stacking would hide a card from its counterpart, and the padding and short
id give up room instead.

```css
/*| id: design-paired-graph
@layer components {
  .paired-graph {
    display: grid;
    /* `minmax(0, 1fr)` and not `1fr`. A bare `1fr` refuses to shrink below
       its content, so one long subject on the left would push the other
       lane off the pane. */
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    align-items: stretch;
    gap: var(--space-2);
    width: 100%;
  }

  .paired-graph__label {
    padding: var(--space-3) var(--space-4);
    font-weight: bold;
    background: var(--surface-raised);
    border-bottom: 1px solid var(--border);
  }

  .paired-graph__rail {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 var(--space-3);
    color: var(--text-faint);
    font-weight: bold;
  }

  .paired-graph__rail--added {
    color: var(--diff-added);
  }

  .paired-graph__rail--dropped {
    color: var(--diff-removed);
  }

  .paired-graph__card {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
  }

  /* A subject is longer than half a pane and every commit here starts with
     the same area prefix, so the end of the line is what tells two apart.
     It wraps rather than truncating. */
  .paired-graph__open {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .paired-graph__card--current {
    border-color: var(--accent);
    background: var(--surface-selected);
  }

  .paired-graph__card-body {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
    gap: var(--space-1);
    padding: 0;
    font: inherit;
    color: inherit;
    text-align: left;
    background: transparent;
    border: none;
    cursor: pointer;
  }

  .paired-graph__card-id {
    font-family: var(--font-mono);
    font-size: var(--text-size-small);
    color: var(--text-muted);
  }

  .paired-graph__card-subject {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .paired-graph__card-nudges {
    display: flex;
    flex-direction: column;
  }

  .paired-graph__nudge {
    padding: 0 var(--space-2);
    font: inherit;
    color: var(--text-muted);
    cursor: pointer;
    background: transparent;
    border: none;
  }

  .paired-graph__nudge:hover {
    color: var(--accent);
  }

  .paired-graph__blank {
    min-height: var(--space-7);
    border: 1px dashed var(--border);
    border-radius: var(--radius);
    background-image: repeating-linear-gradient(
      45deg,
      var(--border-subtle) 0 var(--space-1),
      transparent var(--space-1) var(--space-4)
    );
  }

  .paired-graph__blank--legal {
    border-color: var(--accent);
    border-style: solid;
    background-color: var(--surface-selected);
    background-image: none;
  }

  .paired-graph__footer {
    grid-column: 1 / -1;
    padding: var(--space-4);
    border-top: 1px solid var(--border);
  }

  .paired-graph__reset {
    padding: var(--space-3) var(--space-5);
    font: inherit;
    color: var(--accent);
    cursor: pointer;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }

  .paired-graph__reset:disabled {
    color: var(--text-ghost);
    cursor: default;
  }
}
```

```css
/*| id: design-paired-graph
@layer components-narrow {
  @media (max-width: 1000px) {
    .paired-graph {
      gap: var(--space-1);
    }

    .paired-graph__card {
      gap: var(--space-2);
      padding: var(--space-2) var(--space-3);
    }

    .paired-graph__card-id {
      display: none;
    }

    .paired-graph__nudge {
      padding: 0 var(--space-1);
    }

    .paired-graph__rail {
      padding: 0 var(--space-2);
    }
  }
}
```
