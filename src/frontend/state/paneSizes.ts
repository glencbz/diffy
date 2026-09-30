// ~/~ begin <<docs/architecture/frontend/layout.md#frontend-state-pane-sizes>>[init]
import { useCallback } from "react";
import type { PaneKey, PaneSizes } from "../model/paneSizes";
import { paneSizesRepository } from "../persistence/paneSizes";
import { useStored } from "./stored";

export type Resize = (pane: PaneKey, size: number | null) => void;

export function usePaneSizes(): [PaneSizes, Resize] {
  const [sizes, update] = useStored(paneSizesRepository);

  const resize = useCallback<Resize>(
    (pane, size) => {
      update((current) => {
        const { [pane]: _, ...rest } = current;
        return size === null ? rest : { ...rest, [pane]: size };
      });
    },
    [update],
  );

  return [sizes, resize];
}
// ~/~ end
