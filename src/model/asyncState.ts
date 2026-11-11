// ~/~ begin <<docs/architecture/frontend/index.md#frontend-model-async-state>>[init]
export type AsyncState<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: T };
// ~/~ end
