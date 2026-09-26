// ~/~ begin <<docs/architecture/frontend/index.md#frontend-state-stored>>[init]
import { useCallback, useState } from "react";
import type { Repository } from "../persistence/local";

export type Update<T> = (compute: (current: T) => T) => void;

/** A document held in React state and saved through `repository` on every
 * change. */
export function useStored<T>(repository: Repository<T>): [T, Update<T>] {
  const [document, setDocument] = useState<T>(() => repository.load());

  const update = useCallback<Update<T>>(
    (compute) => {
      setDocument((current) => {
        const next = compute(current);
        repository.save(next);
        return next;
      });
    },
    [repository],
  );

  return [document, update];
}
// ~/~ end
