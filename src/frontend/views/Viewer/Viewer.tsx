// ~/~ begin <<docs/architecture/frontend/viewer.md#frontend-view-viewer>>[init]
import { type CSSProperties, useEffect, useRef, useState } from "react";
import type { Component } from "../../model/components";
import { type BlobName, blobUrl, type Capture } from "../../model/evidence";
import {
  boxStyle,
  type Item,
  itemKey,
  modesFor,
  shownAt,
  VIEW_MODE_NAMES,
  type ViewMode,
} from "../../model/viewer";

/** A run's steps, when the item shown is a run. */
export interface Steps {
  labels: string[];
  at: number;
  /** Why the parent stopped, or null. */
  stopped: string | null;
  onAt: (index: number) => void;
}

export function Viewer({
  items,
  shownKey,
  shown,
  steps,
  mode,
  components,
  reading,
  onPick,
  onStep,
  onMode,
  onGo,
}: {
  /** Every capture and run of the commit, for the strip. */
  items: Item[];
  /** The key of the item shown. */
  shownKey: string;
  /** The capture shown, or the run's step in focus as one. */
  shown: Capture;
  steps: Steps | null;
  mode: ViewMode;
  /** The components of the capture's commit, by id. */
  components: ReadonlyMap<string, Component>;
  /** The id of the component under the reading line. */
  reading: string | null;
  onPick: (key: string) => void;
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

  const latest = useRef({ onStep, steps });
  latest.current = { onStep, steps };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || target.matches("input, textarea, select"))
      ) {
        return;
      }
      const now = latest.current;
      if (event.key === "[") now.onStep(-1);
      else if (event.key === "]") now.onStep(1);
      else if (now.steps !== null && (event.key === "," || event.key === ".")) {
        const next = now.steps.at + (event.key === "," ? -1 : 1);
        if (next >= 0 && next < now.steps.labels.length) now.steps.onAt(next);
      }
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
      {steps !== null && (
        <>
          <ol className="viewer__steps">
            {steps.labels.map((label, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: a step's place is what it is; two steps can share a label
              <li key={`${index}:${label}`}>
                <button
                  type="button"
                  aria-pressed={index === steps.at}
                  className="viewer__step"
                  onClick={() => steps.onAt(index)}
                >
                  {index + 1}. {label}
                </button>
              </li>
            ))}
          </ol>
          {steps.stopped !== null && (
            <p className="viewer__about">
              The parent stopped at {steps.stopped.replace(/\.+$/, "")}.
            </p>
          )}
        </>
      )}
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
      {items.length > 1 && (
        <div className="viewer__strip">
          {items.map((item) => {
            const key = itemKey(item);
            const named =
              item.kind === "capture"
                ? [item.capture.name, ...item.capture.state]
                : [
                    item.run.name,
                    ...item.run.state,
                    `${item.run.after.steps.length} steps`,
                  ];
            const thumb =
              item.kind === "run"
                ? (item.run.after.steps[0]?.shot ?? null)
                : item.capture.media === "image"
                  ? (item.capture.after ?? item.capture.before)
                  : null;
            const about =
              item.kind === "capture" ? item.capture.about : item.run.about;
            return (
              <button
                key={key}
                type="button"
                aria-pressed={key === shownKey}
                className={`viewer__thumb viewer__thumb--${item.kind}`}
                title={about || named[0]}
                onClick={() => onPick(key)}
              >
                {thumb !== null ? (
                  <img src={blobUrl(thumb)} alt="" />
                ) : (
                  <span className="viewer__thumb-clip">▶</span>
                )}
                <span className="viewer__thumb-name">{named.join(" · ")}</span>
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
// ~/~ end
