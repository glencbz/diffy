// ~/~ begin <<docs/architecture/frontend/address.md#frontend-state-place>>[init]
import { useCallback, useEffect, useState } from "react";
import { type Place, readPlace, writePlace } from "../model/place";

export function usePlace(): [Place, (next: Place) => void] {
  const [place, setPlace] = useState<Place>(() => readPlace(window.location));

  useEffect(() => {
    const follow = () => setPlace(readPlace(window.location));
    window.addEventListener("popstate", follow);
    return () => window.removeEventListener("popstate", follow);
  }, []);

  const go = useCallback((next: Place) => {
    const { pathname, search, hash } = window.location;
    const address = writePlace(next);
    if (address !== `${pathname}${search}${hash}`) {
      window.history.pushState(null, "", address);
    }
    setPlace(readPlace(window.location));
  }, []);

  return [place, go];
}
// ~/~ end
// ~/~ begin <<docs/architecture/frontend/address.md#frontend-state-place>>[1]

/** How many times back or forward has changed the address since mount. */
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
