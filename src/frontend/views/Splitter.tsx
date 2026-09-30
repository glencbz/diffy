// ~/~ begin <<docs/architecture/frontend/layout.md#frontend-view-splitter>>[init]
import type {
  CSSProperties,
  KeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { useRef } from "react";
import { clampSize, PANES, type PaneKey } from "../model/paneSizes";

const STEP = 16;

const KEYS: Record<"x" | "y", Record<string, number>> = {
  x: { ArrowLeft: -STEP, ArrowRight: STEP },
  y: { ArrowUp: -STEP, ArrowDown: STEP },
};

/** The inline length a sized pane reads in place of its default. */
export function paneSize(size: number | null): CSSProperties | undefined {
  if (size === null) return undefined;
  return { "--pane-size": `${size}px` } as CSSProperties;
}

interface Measure {
  pane: HTMLElement;
  start: number;
  room: number;
}

interface Drag extends Measure {
  origin: number;
  last: number | null;
}

export function Splitter({
  pane,
  size,
  onResize,
  label,
}: {
  pane: PaneKey;
  size: number | null;
  onResize: (size: number | null) => void;
  label: string;
}) {
  const { axis } = PANES[pane];
  const drag = useRef<Drag | null>(null);

  const along = (element: Element) => {
    const rect = element.getBoundingClientRect();
    return axis === "x" ? rect.width : rect.height;
  };

  const measure = (handle: HTMLElement): Measure | null => {
    const target = handle.previousElementSibling;
    const giving = handle.parentElement?.lastElementChild;
    if (!(target instanceof HTMLElement) || giving == null) return null;
    const start = along(target);
    return { pane: target, start, room: start + along(giving) };
  };

  const point = (event: ReactPointerEvent) =>
    axis === "x" ? event.clientX : event.clientY;

  const finish = () => {
    const last = drag.current?.last ?? null;
    drag.current = null;
    if (last !== null) onResize(last);
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: a focusable separator the reader drags is a widget, and `<hr>` is a thematic break
    <div
      role="separator"
      aria-orientation={axis === "x" ? "vertical" : "horizontal"}
      aria-label={label}
      aria-valuenow={size ?? undefined}
      aria-valuemin={PANES[pane].min}
      tabIndex={0}
      className={`splitter splitter--${axis}`}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        const measured = measure(event.currentTarget);
        if (measured === null) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { ...measured, origin: point(event), last: null };
      }}
      onPointerMove={(event) => {
        const now = drag.current;
        if (now === null) return;
        const next = clampSize(
          pane,
          now.start + point(event) - now.origin,
          now.room,
        );
        now.last = next;
        now.pane.classList.add("pane--sized");
        now.pane.style.setProperty("--pane-size", `${next}px`);
      }}
      onPointerUp={finish}
      onPointerCancel={finish}
      onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
        const step = KEYS[axis][event.key];
        if (step === undefined) return;
        const measured = measure(event.currentTarget);
        if (measured === null) return;
        event.preventDefault();
        onResize(clampSize(pane, measured.start + step, measured.room));
      }}
      onDoubleClick={() => onResize(null)}
    />
  );
}
// ~/~ end
