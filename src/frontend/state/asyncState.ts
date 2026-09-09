// ~/~ begin <<docs/architecture/frontend.md#frontend-async-state>>[init]
export type AsyncState<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: T };
// ~/~ end
