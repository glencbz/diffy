// ~/~ begin <<docs/architecture/frontend/components.md#frontend-view-components-heading>>[init]
import type { MouseEvent, ReactNode } from "react";
import type { Fate, PlaceRef } from "../../model/components";
import { CommentIcon, MessageIcon, SwapIcon } from "./icons";

/** A way to the same place in another comparison, peeked at on hover. */
export interface Switch {
  label: string;
  title: string;
  onPeek: (target: HTMLElement) => void;
  onGo: (heading: HTMLElement | null) => void;
}

/** What a heading says and offers. Side by side, each column's heading
 *  carries its own side and the after column's carries the rest. */
export interface HeadingParts {
  at: PlaceRef;
  path: string;
  /** The words a fate gets when it is not a way to another comparison. */
  fate: { fate: Fate; text: string } | null;
  /** The versions this place can be read in, each its own diff. */
  sides: Switch[];
  /** The comparison of this place with the version it is held against. */
  counterpart: Switch | null;
  move: { text: string; title: string; onGo: () => void } | null;
  message: (() => void) | null;
  threads: { count: number; onOpen: (target: HTMLElement) => void } | null;
  places: { index: number; count: number; onStep: (by: 1 | -1) => void } | null;
  onLeave: () => void;
}

export function Heading({
  at,
  path,
  fate,
  sides,
  counterpart,
  move,
  message,
  threads,
  places,
  onLeave,
}: HeadingParts) {
  const { component, place } = at;
  const heading = (event: MouseEvent<HTMLElement>) =>
    event.currentTarget.closest<HTMLElement>("[data-components-key]");
  const peekable = (each: Switch, children: ReactNode, className: string) => (
    <button
      type="button"
      key={each.label}
      className={className}
      title={each.title}
      onMouseEnter={(event) => each.onPeek(event.currentTarget)}
      onMouseLeave={onLeave}
      onClick={(event) => each.onGo(heading(event))}
    >
      {children}
    </button>
  );
  return (
    <div
      className={`components-heading components-kind--${component.kind}${component.role === "wires" ? " components-heading--minor" : ""}`}
      data-components-key={`${component.commitId}:${component.id}/${place}`}
      data-components-id={component.id}
      data-path={path}
    >
      <span className="components-heading__kind">{component.kind}</span>
      <span className="components-heading__name">{component.name}</span>
      <span className="components-heading__about">
        {component.places[place]?.about ?? ""}
      </span>
      <span className="components-heading__right">
        {move !== null && (
          <button
            type="button"
            className="components-chip"
            title={move.title}
            onClick={move.onGo}
          >
            {move.text}
          </button>
        )}
        {message !== null && (
          <button
            type="button"
            className="components-chip"
            title="where the commit message describes this"
            onClick={message}
          >
            <MessageIcon /> message
          </button>
        )}
        {fate !== null && (
          <span className={`components-fate components-fate--${fate.fate}`}>
            {fate.text}
          </span>
        )}
        {sides.length > 0 && (
          <span
            className="components-switch"
            title="this place in one version's own diff, at this height"
          >
            <SwapIcon />
            {sides.map((side) =>
              peekable(
                side,
                side.label,
                "components-chip components-switch__side",
              ),
            )}
          </span>
        )}
        {counterpart !== null &&
          peekable(
            counterpart,
            <>
              <SwapIcon />
              {counterpart.label}
            </>,
            "components-fate components-fate--changed components-fate--switch",
          )}
        {threads !== null && (
          <button
            type="button"
            className="components-chip"
            title="the threads on this component, on any version"
            onClick={(event) => threads.onOpen(event.currentTarget)}
          >
            <CommentIcon /> {threads.count}
          </button>
        )}
        {places !== null && (
          <span className="components-heading__places">
            <button
              type="button"
              className="components-chip"
              aria-label="previous place"
              onClick={() => places.onStep(-1)}
            >
              ‹
            </button>
            {places.index + 1} of {places.count}
            <button
              type="button"
              className="components-chip"
              aria-label="next place"
              onClick={() => places.onStep(1)}
            >
              ›
            </button>
          </span>
        )}
      </span>
    </div>
  );
}
// ~/~ end
