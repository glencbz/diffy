// ~/~ begin <<docs/architecture/frontend/address.md#frontend-state-place>>[init]
import { useCallback, useEffect, useState } from "react";
import { type Place, readPlace, writePlace } from "../model/place";

/** Whether a move leaves a step behind for back, or rewrites the one the
 *  reader is on. */
export type Visit = "push" | "replace";

export function usePlace(): [Place, (next: Place, visit?: Visit) => void] {
  const [place, setPlace] = useState<Place>(() => readPlace(window.location));

  useEffect(() => {
    const follow = () => setPlace(readPlace(window.location));
    window.addEventListener("popstate", follow);
    return () => window.removeEventListener("popstate", follow);
  }, []);

  const go = useCallback((next: Place, visit: Visit = "push") => {
    const { pathname, search, hash } = window.location;
    const address = writePlace(next);
    // Re-clicking the current place leaves no step for back to spend.
    if (address !== `${pathname}${search}${hash}`) {
      if (visit === "push") window.history.pushState(null, "", address);
      else window.history.replaceState(null, "", address);
    }
    // Read back what was written, so a place that does not survive the round
    // trip (line 0) shows up now rather than after a reload.
    setPlace(readPlace(window.location));
  }, []);

  return [place, go];
}
// ~/~ end
// ~/~ begin <<docs/architecture/frontend/address.md#frontend-state-place>>[1]

/** How many times back or forward has changed the address since mount. A
 *  screen scrolls to what is picked when this moves, and leaves the view
 *  alone when the reader's own click moved the place. */
export function useArrivals(): number {
  const [arrivals, setArrivals] = useState(0);

  useEffect(() => {
    const arrive = () => setArrivals((now) => now + 1);
    window.addEventListener("popstate", arrive);
    return () => window.removeEventListener("popstate", arrive);
  }, []);

  return arrivals;
}
// ~/~ end
