// ~/~ begin <<docs/architecture/frontend/panels.md#frontend-state-focus>>[init]
import { useCallback, useState } from "react";
import { type Asked, type Location, sameLocation } from "../model/location";

export interface Focus {
  /** What the reading line is over, or null above the first heading. */
  reading: Location | null;
  onRead: (next: Location | null) => void;
  /** The last place a follower asked the code to go. */
  asked: Asked | null;
  ask: (location: Location) => void;
}

export function useFocus(): Focus {
  const [reading, setReading] = useState<Location | null>(null);
  const [asked, setAsked] = useState<Asked | null>(null);
  const ask = useCallback(
    (location: Location) =>
      setAsked((now) => ({ location, at: (now?.at ?? 0) + 1 })),
    [],
  );
  // The reading line reports on every frame of a scroll; only a change
  // draws anything again.
  const onRead = useCallback(
    (next: Location | null) =>
      setReading((now) => (sameLocation(now, next) ? now : next)),
    [],
  );
  return { reading, onRead, asked, ask };
}
// ~/~ end
