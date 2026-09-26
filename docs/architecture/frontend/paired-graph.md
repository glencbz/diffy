# Paired graph

A pairing is easy to draw as one list: one row per slot, the two ids set
side by side in it. What that throws away is which version a blank belongs
to. A slot with `left: null` needs the reader to see there was nothing on
the old side to face this commit, not read a caption saying so. Two lanes
with the blank drawn as a gap says that in the shape of the page. An empty
column between two full ones reads as missing before the reader has parsed
a single word of it, the way an empty parking space reads as missing a car.

`PairedGraph` draws `usePairing`'s `Slot[]` as that pair of lanes, a narrow
rail between them, and the controls that let the reader correct a slot the
heuristic guessed wrong.

## Row shape

A slot names three shapes: a commit that showed up only in the new series,
one that only showed up in the old one, and one lined up on both sides.
`rowKind` reads that off a `Slot` directly, and nothing else, because
nothing else is in a `Slot` to read.

The rail beside each row marks that same shape and nothing more: `+` for
added, `−` for dropped, `~` for paired. It cannot say whether a paired
commit changed, because that answer lives in a diff and this pane holds
only a `Slot[]`, two ids or their absence. The pane a reader opens by
clicking a row is the one place that has fetched anything to compare, and
[it already says](diff.md#interdiff-rows) when a paired commit turned out
to make the same change. A second, cheaper-looking answer here would
disagree with that one exactly when a reader had not requested it yet,
which is worse than the rail saying less.

## Moving a card

Cards drag from one blank to another on their own side. `PairedGraph` keeps
one thing in component state while a drag is in flight: which side and
index it started from. A blank highlights only when `pairing.legalTargets`
names it for that dragged card, which keeps the highlight in step with the
same rule `nudge` and `move` already enforce; a second copy of "how far can
this card travel" here would drift from theirs the first time either
changed.

The `↑` and `↓` buttons move the same card the same one row `nudge`
already knows how to move, and they exist because a drag is not a control
every reader can reach. There is no keyboard path onto a native HTML5 drag,
and a touch drag on a tall pane fights the page's own scroll before it
manages to move anything. [The pull request picker gave up a shift-click for
the same reason](pull-requests.md#pull-comparison-picker): a control that
only half its audience can operate is not the control to ship alone beside
one that works for everyone.

An arrow that loses focus after one press is not a keyboard path either. A
nudge changes the slots it touches, and a row is keyed by its slot, so the
card that moved remounts and focus falls back to the page. `refocus` names
the card and the direction just pressed, and the matching arrow takes focus
back as it mounts, so holding a key walks a card as far as it can go.

```tsx
//| id: frontend-view-paired-graph
//| file: src/frontend/views/PairedGraph.tsx
import { Fragment, type RefObject, useRef, useState } from "react";
import type { GitCommit } from "../api";
import type { Pairing, Side, Slot } from "../state/pairing";

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

`pairing.slots`'s index is the row's key as well as its identity. A blank
row carries nothing else stable to key it by, and the index is exactly what
`onSelect`, `nudge`, and `move` already address a row by, so a second key
scheme here would only be one more thing to keep lined up with the one
`usePairing` already uses.

## Styling

The two lanes and the rail are one CSS grid, `1fr auto 1fr`, with the
header labels, every row's three cells, and the footer all flowing into it
in document order. The rail column is sized to its own content rather than
a fixed length, because the mark inside it is one character and a length
declared for that would be a number standing in for "as wide as a
character," which `auto` already says without a name to look up.

A blank is drawn as a gap the way the prose above argues it has to be: a
dashed border and a hatch built from `--border-subtle` against nothing say
"there is space here and nothing in it" without a caption doing the same
job in words. Dragging a card turns that same gap into a target the moment
it is a legal one, with a solid accent border and the same selected surface
a chosen row uses elsewhere in the app, so a reader mid-drag sees exactly
which blanks will take the card without reading `legalTargets` themselves.

Below [the thousand-pixel line every narrow rule in this app shares](layout.md),
the two lanes stay side by side rather than stacking, because stacking would
put a card and its counterpart out of each other's sight, which is the one
thing this pane exists to keep in view. What gives up room instead is the
padding, the short commit id, which a reader can still open the card to
read, and the rail's own width.

```css
/*| id: design-paired-graph
@layer components {
  /* The commits pane is sized for one lane. A paired graph draws two, so
     the pane it sits in takes the wider metric. Sizing the grid alone would
     leave it scrolling one of its two lanes out of sight inside a pane that
     never grew. */
  .pane--commits:has(.paired-graph) {
    width: var(--pane-paired-width);
  }

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
