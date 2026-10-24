// ~/~ begin <<docs/architecture/frontend/panels.md#frontend-view-panels-host>>[init]
import { useEffect, useRef } from "react";

const scrolls = new WeakMap<Element, number>();
const kept = new WeakSet<HTMLElement>();

export function Host({ host }: { host: HTMLElement }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (box.current === null) return;
    if (!kept.has(host)) {
      kept.add(host);
      // Captured, since a scroll does not bubble.
      host.addEventListener(
        "scroll",
        (event) => {
          if (event.target instanceof Element && event.target.isConnected) {
            scrolls.set(event.target, event.target.scrollTop);
          }
        },
        { capture: true, passive: true },
      );
    }
    const into = box.current;
    into.appendChild(host);
    for (const element of [host, ...host.querySelectorAll("*")]) {
      const top = scrolls.get(element);
      if (top !== undefined && element.scrollTop !== top) {
        element.scrollTop = top;
      }
    }
    return () => {
      if (host.parentElement === into) into.removeChild(host);
    };
  }, [host]);
  return <div className="panel-body" ref={box} />;
}
// ~/~ end
