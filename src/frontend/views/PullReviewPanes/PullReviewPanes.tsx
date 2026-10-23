// ~/~ begin <<docs/architecture/frontend/layout.md#frontend-view-pull-review-panes>>[init]
import type { ComponentProps, ReactNode } from "react";
import { Panels } from "../Panels/Panels";
import { DrawerBar } from "./DrawerBar";

/** Where the reader is in the stack: the row picked, if any, out of how
 *  many, and a line naming it. */
export interface StackPosition {
  index: number | null;
  count: number;
  summary: string;
}

export function PullReviewPanes({
  header,
  picker,
  position,
  onStep,
  ...panels
}: {
  /** The series screen's header, which a pull request and a local review
   *  each fill in for themselves. */
  header: ReactNode;
  picker: ReactNode;
  position: StackPosition;
  onStep: (step: -1 | 1) => void;
} & Omit<ComponentProps<typeof Panels>, "bar">) {
  return (
    <>
      {header}
      <div className="pull-toolbar">{picker}</div>
      <Panels
        {...panels}
        bar={<DrawerBar position={position} onStep={onStep} />}
      />
    </>
  );
}
// ~/~ end
