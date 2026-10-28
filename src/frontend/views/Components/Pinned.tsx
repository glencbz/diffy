// ~/~ begin <<docs/architecture/frontend/components.md#frontend-view-components-pinned>>[init]
import {
  type MouseEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

type Side = "before" | "after";
interface Under {
  heading: HTMLElement;
  key: string;
  side: Side;
}

/** The heading of the run under a file's header, drawn again in the
 *  header so it stays in reach while the run scrolls under it. */
export function Pinned({
  draw,
  lineClass,
}: {
  draw: (key: string, side: Side) => ReactNode;
  /** The class a line of the component takes. */
  lineClass: (id: string) => string;
}) {
  const slot = useRef<HTMLDivElement>(null);
  const [under, setUnder] = useState<Under | null>(null);
  const shown = under === null ? null : draw(under.key, under.side);

  // biome-ignore lint/correctness/useExhaustiveDependencies: lineClass is the same rule on every drawing
  useEffect(() => {
    const own = slot.current;
    const file = own?.closest<HTMLElement>(".diff-file");
    const header = file?.querySelector<HTMLElement>(":scope > header");
    if (!own || !file || !header) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      // Empty, the slot is not laid out; drawn, it starts where the
      // header's own row ends, so showing it never moves the edge.
      const edge = own.hasChildNodes()
        ? own.getBoundingClientRect().top
        : header.getBoundingClientRect().bottom;
      const next = runUnder(file, edge, lineClass);
      setUnder((was) =>
        was?.heading === next?.heading && was?.side === next?.side ? was : next,
      );
    };
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(update);
    };
    // Captured, so the scroll of whichever pane holds the diff reaches it.
    document.addEventListener("scroll", schedule, {
      capture: true,
      passive: true,
    });
    const resized = new ResizeObserver(schedule);
    resized.observe(file);
    update();
    return () => {
      document.removeEventListener("scroll", schedule, { capture: true });
      resized.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);

  useLayoutEffect(() => {
    const copy = slot.current?.firstElementChild;
    if (!under || !copy) return;
    copy.toggleAttribute(
      "data-components-again",
      under.heading.hasAttribute("data-components-again"),
    );
    const count = copy.querySelector(".components-heading__count");
    if (count) {
      count.textContent =
        under.heading.querySelector(".components-heading__count")
          ?.textContent ?? "";
    }
    copy
      .querySelector(".components-heading__places")
      ?.toggleAttribute(
        "hidden",
        under.heading
          .querySelector(".components-heading__places")
          ?.hasAttribute("hidden") ?? true,
      );
  });

  // Seen folds a run, as the chevron does, and folding it from the copy
  // would pull whatever follows up past the reader. The heading takes the
  // copy's place instead, so the next run starts under it.
  const settle = (event: MouseEvent) => {
    const target = event.target as Element;
    if (
      !under ||
      !target.closest(".components-heading__seen, .components-heading__fold")
    ) {
      return;
    }
    const { heading } = under;
    const file = heading.closest<HTMLElement>(".diff-file");
    const header = file?.querySelector(":scope > header");
    let pane = file?.parentElement ?? null;
    while (pane && !/auto|scroll/.test(getComputedStyle(pane).overflowY)) {
      pane = pane.parentElement;
    }
    if (!file || !header) return;
    // The fold lands when the review answers, so wait for the file to
    // shrink rather than for a frame. Observing reports the size it has
    // now first; the fold is the change after.
    let sized = false;
    const folded = new ResizeObserver(() => {
      if (!sized) {
        sized = true;
        return;
      }
      folded.disconnect();
      (pane ?? document.scrollingElement)?.scrollBy(
        0,
        heading.getBoundingClientRect().top -
          header.getBoundingClientRect().bottom,
      );
    });
    folded.observe(file);
    setTimeout(() => folded.disconnect(), 1000);
  };

  return (
    <div className="components-pinned" ref={slot} onClickCapture={settle}>
      {shown}
    </div>
  );
}

/** The heading whose run crosses `edge`, if one does. */
function runUnder(
  file: HTMLElement,
  edge: number,
  lineClass: (id: string) => string,
): Under | null {
  const box = file.getBoundingClientRect();
  const patch = file.querySelector(".diff-file__patch");
  if (patch === null || box.top >= edge || box.bottom <= edge) return null;
  let heading: HTMLElement | null = null;
  for (const each of patch.querySelectorAll<HTMLElement>(
    "[data-components-key]",
  )) {
    if (each.getBoundingClientRect().top >= edge) break;
    heading = each;
  }
  const key = heading?.dataset.componentsKey;
  const id = heading?.dataset.componentsId;
  if (!heading || key === undefined || id === undefined) return null;
  // The run is the component's lines up to the next heading of any run.
  const own = lineClass(id);
  let row: Element = heading;
  while (row.parentElement !== patch && row.parentElement !== null) {
    row = row.parentElement;
  }
  let last: Element | null = null;
  for (
    let each = row.nextElementSibling;
    each;
    each = each.nextElementSibling
  ) {
    if (
      each.matches("[data-components-key]") ||
      each.querySelector("[data-components-key]")
    ) {
      break;
    }
    if (each.classList.contains(own) || each.querySelector(`.${own}`)) {
      last = each;
    }
  }
  if (last === null || last.getBoundingClientRect().bottom <= edge) {
    return null;
  }
  const side = heading.closest(".diff-line--before") ? "before" : "after";
  return { heading, key, side };
}
// ~/~ end
