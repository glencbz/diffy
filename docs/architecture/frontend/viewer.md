# Viewer

The panel that shows the [captures](../backend/evidence.md#a-capture) an
agent attached to the commit being read, its parent's picture beside the
commit's, with a box on each component the capture shows. It is one of the
[panels](panels.md), and like every panel but the code it follows the
[focus](panels.md#the-focus) rather than leading it.

## Which capture

The viewer shows one capture of the commit in view at a time, or of the
whole version while the reader has not reached a commit yet, so a review
that opens on its full stack still shows what the author recorded. The
reader picks one from the strip under the picture, and it holds while they
read the component they were on. Once they read on, the viewer moves to a
capture that shows the new component, and back to the pick if it shows it.
Following never rewrites the pick: a viewer that did would forget what the
reader chose the moment they scrolled past it.

A capture can only be laid over its other side when both sides are
pictures, so a clip, or a capture with one side missing, is shown side by
side whatever mode the reader chose.

```ts
//| id: frontend-model-viewer
//| file: src/frontend/model/viewer.ts
import type { Box, Capture, Shown } from "./evidence";

export const VIEW_MODES = ["side", "swipe", "fade", "difference"] as const;
export type ViewMode = (typeof VIEW_MODES)[number];

export const VIEW_MODE_NAMES: Record<ViewMode, string> = {
  side: "Side by side",
  swipe: "Swipe",
  fade: "Fade",
  difference: "Difference",
};

/** The captures of one commit, or of every commit while none is in
 *  view, in the order they came. */
export function capturesAt(
  captures: Capture[],
  commitId: string | null,
): Capture[] {
  return commitId === null
    ? captures
    : captures.filter((each) => each.commitId === commitId);
}

/** A capture the reader picked, and the component they were reading
 *  when they picked it. */
export interface Pick {
  id: string;
  reading: string | null;
}

/** The capture to show: the pick until the reader reads on, or while it
 *  shows what they read; else the first that shows it; else the pick,
 *  else the first. */
export function followCapture(
  captures: Capture[],
  picked: Pick | null,
  reading: string | null,
): Capture | null {
  const pick = captures.find((each) => each.id === picked?.id);
  const shows = (capture: Capture) =>
    reading !== null &&
    capture.shows.some((shown) => shown.component === reading);
  if (
    pick !== undefined &&
    (reading === null || reading === picked?.reading || shows(pick))
  ) {
    return pick;
  }
  return captures.find(shows) ?? pick ?? captures[0] ?? null;
}

/** The capture `step` along from `at`, wrapping round. */
export function stepCapture(
  captures: Capture[],
  at: string | null,
  step: -1 | 1,
): string | null {
  if (captures.length === 0) return null;
  const index = captures.findIndex((each) => each.id === at);
  const next = (index + step + captures.length) % captures.length;
  return captures[index === -1 ? 0 : next]?.id ?? null;
}

/** The modes `capture` can be shown in. */
export function modesFor(capture: Capture): ViewMode[] {
  return capture.media === "image" &&
    capture.before !== null &&
    capture.after !== null
    ? [...VIEW_MODES]
    : ["side"];
}

/** What the capture shows `time` seconds into a clip, or at all for a
 *  picture, whose time is null. */
export function shownAt(capture: Capture, time: number | null): Shown[] {
  return capture.shows.filter(
    (shown) =>
      shown.at === undefined ||
      time === null ||
      (time >= shown.at[0] && time <= shown.at[1]),
  );
}

/** A box as CSS offsets within its picture. */
export function boxStyle([left, top, width, height]: Box) {
  const percent = (fraction: number) => `${(fraction * 100).toFixed(3)}%`;
  return {
    left: percent(left),
    top: percent(top),
    width: percent(width),
    height: percent(height),
  };
}
```

## Going to a component

A box leads to its component in the code, the way an entry in the
[rail](components.md#the-rail) does. The viewer cannot scroll the code
itself, so it asks through the focus, and the components view, which owns
the code's scroll, lands on the component and lets the reading line report
it as it would for any scroll. A box click is a passing move rather than a
place worth a link, so it stays out of the [address](address.md).

## The panel

The pictures share one frame, so a box drawn as fractions of the frame
lands on the same spot of either side. Boxes go on the commit's side, the
one the agent measured, or on the parent's when the commit has none. The
component being read stands out and the others dim, so a reader scrolling
the code sees where on screen they are; while nothing on the capture is
being read, every box is drawn alike.

A clip plays both sides together: playing, pausing or seeking the commit's
side does the same to its parent's, and the boxes follow the commit's time.
`[` and `]` step through the commit's captures from anywhere on the screen,
as the panels' own keys do.

```tsx
//| id: frontend-view-viewer
//| file: src/frontend/views/Viewer/Viewer.tsx
import { type CSSProperties, useEffect, useRef, useState } from "react";
import type { Component } from "../../model/components";
import { type BlobName, blobUrl, type Capture } from "../../model/evidence";
import {
  boxStyle,
  modesFor,
  shownAt,
  VIEW_MODE_NAMES,
  type ViewMode,
} from "../../model/viewer";

export function Viewer({
  captures,
  shown,
  mode,
  components,
  reading,
  onPick,
  onStep,
  onMode,
  onGo,
}: {
  /** Every capture of the commit, for the strip. */
  captures: Capture[];
  shown: Capture;
  mode: ViewMode;
  /** The components of the capture's commit, by id. */
  components: ReadonlyMap<string, Component>;
  /** The id of the component under the reading line. */
  reading: string | null;
  onPick: (id: string) => void;
  onStep: (step: -1 | 1) => void;
  onMode: (mode: ViewMode) => void;
  onGo: (component: string) => void;
}) {
  const modes = modesFor(shown);
  const showing = modes.includes(mode) ? mode : "side";
  const [time, setTime] = useState<number | null>(null);
  const [cut, setCut] = useState(0.5);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new capture starts its clip, and its cut, afresh
  useEffect(() => {
    setTime(null);
    setCut(0.5);
  }, [shown.id, shown.commitId]);

  const latest = useRef(onStep);
  latest.current = onStep;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || target.matches("input, textarea, select"))
      ) {
        return;
      }
      if (event.key === "[") latest.current(-1);
      else if (event.key === "]") latest.current(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // A clip that has not played yet is at its start.
  const shows = shownAt(shown, shown.media === "video" ? (time ?? 0) : null);
  const readingHere = shows.some((each) => each.component === reading);
  const boxes = (
    <span className="viewer-boxes">
      {shows.map((each) =>
        each.box === undefined ? null : (
          <button
            key={each.component}
            type="button"
            style={boxStyle(each.box)}
            title={each.about || undefined}
            className={`viewer-box components-kind--${components.get(each.component)?.kind ?? "unknown"}${!readingHere ? "" : each.component === reading ? " viewer-box--reading" : " viewer-box--quiet"}${each.box[1] < 0.06 ? " viewer-box--top" : ""}${each.box[0] + each.box[2] / 2 > 0.6 ? " viewer-box--right" : ""}`}
            onClick={() => onGo(each.component)}
          >
            <span className="viewer-box__name">
              {components.get(each.component)?.name ?? each.component}
            </span>
          </button>
        ),
      )}
    </span>
  );
  const boxesOn = shown.after !== null ? "after" : "before";

  return (
    <div className="viewer">
      <div className="viewer__head">
        <p className="viewer__title">
          <span className="viewer__name">{shown.name}</span>
          {shown.state.map((state) => (
            <span key={state} className="viewer__state">
              {state}
            </span>
          ))}
        </p>
        {modes.length > 1 && (
          <span className="viewer__modes">
            {modes.map((each) => (
              <button
                key={each}
                type="button"
                aria-pressed={each === showing}
                className="viewer__mode"
                onClick={() => onMode(each)}
              >
                {VIEW_MODE_NAMES[each]}
              </button>
            ))}
          </span>
        )}
      </div>
      {shown.about !== "" && <p className="viewer__about">{shown.about}</p>}
      {showing === "side" ? (
        <div
          className={`viewer__sides${shown.before === null || shown.after === null ? " viewer__sides--one" : ""}`}
        >
          {(["before", "after"] as const).map((side) =>
            shown[side] === null ? (
              <p key={side} className="viewer__none">
                {side === "before"
                  ? "Nothing to show at the parent."
                  : "Nothing to show at this commit."}
              </p>
            ) : (
              <figure key={side} className="viewer__side">
                <figcaption className="viewer__caption">
                  {side === "before" ? "parent" : "this commit"}
                </figcaption>
                <span className={`viewer__frame viewer__frame--${shown.media}`}>
                  <Media
                    capture={shown}
                    name={shown[side] as BlobName}
                    side={side}
                    onTime={side === "after" ? setTime : null}
                  />
                  {side === boxesOn && boxes}
                </span>
              </figure>
            ),
          )}
        </div>
      ) : (
        <div className="viewer__overlay">
          <span
            className={`viewer__frame viewer__frame--${showing}`}
            style={{ "--viewer-cut": cut } as CSSProperties}
          >
            <img
              src={blobUrl(shown.before as BlobName)}
              alt={`${shown.name} at the parent`}
              className="viewer__media"
            />
            <img
              src={blobUrl(shown.after as BlobName)}
              alt={`${shown.name} at this commit`}
              className="viewer__media viewer__media--top"
            />
            {boxes}
          </span>
          {showing !== "difference" && (
            <label className="viewer__cut">
              <span>parent</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={cut}
                onChange={(event) => setCut(Number(event.target.value))}
              />
              <span>this commit</span>
            </label>
          )}
        </div>
      )}
      {captures.length > 1 && (
        <div className="viewer__strip">
          {captures.map((capture) => {
            const thumb = capture.after ?? capture.before;
            return (
              <button
                key={capture.id}
                type="button"
                aria-pressed={capture.id === shown.id}
                className="viewer__thumb"
                title={capture.about || capture.name}
                onClick={() => onPick(capture.id)}
              >
                {capture.media === "image" && thumb !== null ? (
                  <img src={blobUrl(thumb)} alt="" />
                ) : (
                  <span className="viewer__thumb-clip">▶</span>
                )}
                <span className="viewer__thumb-name">
                  {[capture.name, ...capture.state].join(" · ")}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** One side of a capture. The commit's clip leads its parent's: whatever
 *  the reader does to it, the other does too. */
function Media({
  capture,
  name,
  side,
  onTime,
}: {
  capture: Capture;
  name: BlobName;
  side: "before" | "after";
  onTime: ((time: number) => void) | null;
}) {
  const alt = `${capture.name} ${side === "before" ? "at the parent" : "at this commit"}`;
  if (capture.media === "image") {
    return <img src={blobUrl(name)} alt={alt} className="viewer__media" />;
  }
  const follow = (lead: HTMLVideoElement) => {
    const other = lead
      .closest(".viewer__sides")
      ?.querySelector<HTMLVideoElement>(".viewer__media--before");
    if (other === null || other === undefined) return;
    if (Math.abs(other.currentTime - lead.currentTime) > 0.2) {
      other.currentTime = lead.currentTime;
    }
    if (lead.paused !== other.paused) {
      if (lead.paused) other.pause();
      else void other.play();
    }
  };
  return (
    <video
      src={blobUrl(name)}
      aria-label={alt}
      controls={side === "after"}
      muted
      playsInline
      className={`viewer__media viewer__media--${side}`}
      onTimeUpdate={(event) => {
        onTime?.(event.currentTarget.currentTime);
        if (side === "after") follow(event.currentTarget);
      }}
      onPlay={(event) => side === "after" && follow(event.currentTarget)}
      onPause={(event) => side === "after" && follow(event.currentTarget)}
      onSeeked={(event) => side === "after" && follow(event.currentTarget)}
    />
  );
}
```

## Styling

```css
/*| id: design-viewer
@layer components {
  .viewer {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4);
  }

  .viewer__head {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    align-items: center;
    justify-content: space-between;
  }

  .viewer__title {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: baseline;
    margin: 0;
  }

  .viewer__name {
    font-weight: bold;
  }

  .viewer__state {
    padding: 0 var(--space-2);
    font-size: var(--text-size-small);
    color: var(--text-muted);
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }

  .viewer__modes {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    font-size: var(--text-size-small);
  }

  .viewer__mode {
    padding: var(--space-1) var(--space-3);
    font: inherit;
    color: var(--text-muted);
    cursor: pointer;
    background: none;
    border: 1px solid transparent;
    border-radius: var(--radius);
  }

  .viewer__mode[aria-pressed="true"] {
    color: var(--text);
    background: var(--surface);
    border-color: var(--border);
  }

  .viewer__about {
    margin: 0;
    color: var(--text-muted);
  }

  /* Side by side while each side has room for a readable picture, one
     above the other in a narrow panel. */
  .viewer__sides {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(16em, 1fr));
    gap: var(--space-4);
    align-items: start;
  }

  /* With one side missing, the side there is takes the panel's width. */
  .viewer__sides--one {
    grid-template-columns: 1fr;
  }

  .viewer__side {
    margin: 0;
  }

  .viewer__caption {
    margin-bottom: var(--space-2);
    font-size: var(--text-size-small);
    color: var(--text-muted);
  }

  .viewer__none {
    margin: 0;
    color: var(--text-faint);
  }

  /* The frame is exactly the picture's size, so boxes kept as fractions of
     the picture land on it. */
  .viewer__frame {
    position: relative;
    display: block;
    border: 1px solid var(--border);
  }

  .viewer__media {
    display: block;
    width: 100%;
    height: auto;
  }

  .viewer__frame--swipe .viewer__media--top,
  .viewer__frame--fade .viewer__media--top,
  .viewer__frame--difference .viewer__media--top {
    position: absolute;
    inset: 0;
  }

  .viewer__frame--swipe .viewer__media--top {
    clip-path: inset(0 0 0 calc((1 - var(--viewer-cut)) * 100%));
  }

  .viewer__frame--fade .viewer__media--top {
    opacity: var(--viewer-cut);
  }

  .viewer__frame--difference .viewer__media--top {
    mix-blend-mode: difference;
  }

  .viewer__cut {
    display: flex;
    gap: var(--space-3);
    align-items: center;
    font-size: var(--text-size-small);
    color: var(--text-muted);
  }

  .viewer__cut input {
    flex: 1;
  }

  .viewer-boxes {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .viewer-box {
    position: absolute;
    padding: 0;
    font: inherit;
    cursor: pointer;
    pointer-events: auto;
    background: color-mix(in srgb, var(--component) 12%, transparent);
    border: 2px solid var(--component);
    border-radius: var(--radius);
  }

  .viewer-box--reading {
    background: color-mix(in srgb, var(--component) 22%, transparent);
    box-shadow: 0 0 0 2px var(--surface);
  }

  .viewer-box--quiet {
    opacity: 0.35;
  }

  /* The name hangs above the box, so it never covers what the box shows,
     except at the picture's top edge, where above would cover the
     caption. A box on the right hangs its name from its right edge, so
     the name stays on the picture. */
  .viewer-box__name {
    position: absolute;
    bottom: 100%;
    left: -2px;
    padding: 0 var(--space-2);
    font-size: var(--text-size-small);
    color: var(--surface);
    white-space: nowrap;
    background: var(--component);
    border-radius: var(--radius) var(--radius) 0 0;
  }

  .viewer-box--top .viewer-box__name {
    top: 0;
    bottom: auto;
    border-radius: 0 0 var(--radius) 0;
  }

  .viewer-box--right .viewer-box__name {
    right: -2px;
    left: auto;
  }

  /* Over a clip the player's controls sit under the boxes, so only a
     box's name answers a click there. */
  .viewer__frame--video .viewer-box {
    pointer-events: none;
  }

  .viewer__frame--video .viewer-box__name {
    pointer-events: auto;
  }

  .viewer__strip {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .viewer__thumb {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    width: 8em;
    padding: var(--space-1);
    font: inherit;
    font-size: var(--text-size-small);
    color: var(--text-muted);
    text-align: left;
    cursor: pointer;
    background: none;
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }

  .viewer__thumb[aria-pressed="true"] {
    color: var(--text);
    border-color: var(--accent);
  }

  .viewer__thumb img,
  .viewer__thumb-clip {
    display: block;
    width: 100%;
    height: 4.5em;
    object-fit: cover;
    object-position: top;
  }

  .viewer__thumb-clip {
    display: grid;
    place-items: center;
    background: var(--surface-sunken);
  }

  .viewer__thumb-name {
    overflow-wrap: anywhere;
  }
}
```

## Tests

```ts
//| id: frontend-model-viewer-test
//| file: src/frontend/model/viewer.test.ts
import { describe, expect, test } from "bun:test";
import type { Capture } from "./evidence";
import { followCapture, modesFor, shownAt, stepCapture } from "./viewer";

const PNG = `${"a".repeat(64)}.png` as const;

function capture(id: string, shows: string[], more: Partial<Capture> = {}) {
  return {
    series: "local:r",
    version: "1",
    commitId: "c1",
    id,
    name: id,
    state: [],
    about: "",
    media: "image",
    before: PNG,
    after: PNG,
    shows: shows.map((component) => ({ component, about: "" })),
    attachedAt: "2026-10-24T00:00:00Z",
    ...more,
  } satisfies Capture;
}

describe("following the reading", () => {
  const captures = [
    capture("home", ["header"]),
    capture("settings", ["switch"]),
  ];

  test("keeps the pick while it shows the component being read", () => {
    // act
    const shown = followCapture(
      [...captures, capture("both", ["switch"])],
      { id: "both", reading: null },
      "switch",
    );

    // assert
    expect(shown?.id).toBe("both");
  });

  test("moves to a capture that shows what is read on", () => {
    // act
    const shown = followCapture(
      captures,
      { id: "home", reading: "header" },
      "switch",
    );

    // assert
    expect(shown?.id).toBe("settings");
  });

  test("holds a pick until the reader reads on", () => {
    // act
    const shown = followCapture(
      captures,
      { id: "home", reading: "switch" },
      "switch",
    );

    // assert
    expect(shown?.id).toBe("home");
  });

  test("keeps the pick when nothing shows what is read", () => {
    // act
    const shown = followCapture(
      captures,
      { id: "settings", reading: null },
      "theme-store",
    );

    // assert
    expect(shown?.id).toBe("settings");
  });

  test("starts on the first capture", () => {
    // act
    const shown = followCapture(captures, null, null);

    // assert
    expect(shown?.id).toBe("home");
  });
});

describe("the viewer's choices", () => {
  test("steps round the commit's captures", () => {
    // arrange
    const captures = [capture("a", []), capture("b", [])];

    // act
    const back = stepCapture(captures, "a", -1);

    // assert
    expect(back).toBe("b");
  });

  test("only lays a picture over its other side", () => {
    // act
    const modes = [
      modesFor(capture("both", [])),
      modesFor(capture("new", [], { before: null })),
      modesFor(capture("clip", [], { media: "video" })),
    ];

    // assert
    expect(modes.map((each) => each.length)).toEqual([4, 1, 1]);
  });

  test("a clip shows a component only within its span", () => {
    // arrange
    const clip = capture("clip", [], {
      media: "video",
      shows: [
        { component: "switch", at: [1, 2], about: "" },
        { component: "header", about: "" },
      ],
    });

    // act
    const early = shownAt(clip, 0.5).map((each) => each.component);

    // assert
    expect(early).toEqual(["header"]);
  });
});
```
