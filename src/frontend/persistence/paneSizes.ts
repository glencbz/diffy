// ~/~ begin <<docs/architecture/frontend/layout.md#frontend-persistence-pane-sizes>>[init]
import { PaneSizes } from "../model/paneSizes";
import { localRepository } from "./local";

export const paneSizesRepository = localRepository<PaneSizes>(
  "diffy.panes.v1",
  PaneSizes,
  {},
);
// ~/~ end
