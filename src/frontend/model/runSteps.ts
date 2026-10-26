// ~/~ begin <<docs/architecture/frontend/runs.md#frontend-model-run-steps>>[init]
import type { Capture } from "./evidence";
import type { RowComment } from "./review";
import type { Logged, Request, Run, RunStep } from "./runs";

/** The step `index` of `run` drawn as a picture capture. */
export function stepAsCapture(run: Run, index: number): Capture {
  const after = run.after.steps[index];
  const before = run.before?.steps[index];
  return {
    series: run.series,
    version: run.version,
    commitId: run.commitId,
    id: `${run.id}#${index}`,
    name: run.name,
    state: run.state,
    about: run.about,
    media: "image",
    before: before?.shot ?? null,
    after: after?.shot ?? null,
    shows: [],
    attachedAt: run.recordedAt,
  };
}

/** The two sides of one step: the parent's is null where it stopped. */
export function stepsAt(
  run: Run,
  index: number,
): { before: RunStep | null; after: RunStep | null } {
  return {
    before: run.before?.steps[index] ?? null,
    after: run.after.steps[index] ?? null,
  };
}

export type Change = "same" | "new" | "gone" | "changed";

export interface Compared<T> {
  change: Change;
  before: T | null;
  after: T | null;
}

/** A step's requests, the commit's in order and then those only the parent
 *  made, matched by method and address: a request is new, gone, answered
 *  differently, or the same. */
export function compareRequests(
  before: Request[] | null,
  after: Request[],
): Compared<Request>[] {
  return compare(
    before,
    after,
    (request) => `${request.method} ${request.url}`,
    (a, b) => a.status === b.status && a.body === b.body,
  );
}

/** A step's console, matched by level and text. */
export function compareLogged(
  before: Logged[] | null,
  after: Logged[],
): Compared<Logged>[] {
  return compare(
    before,
    after,
    (line) => `${line.level} ${line.text}`,
    () => true,
  );
}

function compare<T>(
  before: T[] | null,
  after: T[],
  keyOf: (item: T) => string,
  same: (a: T, b: T) => boolean,
): Compared<T>[] {
  // Each key can come more than once; pair them in order.
  const waiting = new Map<string, T[]>();
  for (const item of before ?? []) {
    const key = keyOf(item);
    waiting.set(key, [...(waiting.get(key) ?? []), item]);
  }
  const out: Compared<T>[] = after.map((item) => {
    const match = waiting.get(keyOf(item))?.shift() ?? null;
    if (before === null) return { change: "same", before: null, after: item };
    if (match === null) return { change: "new", before: null, after: item };
    return {
      change: same(match, item) ? "same" : "changed",
      before: match,
      after: item,
    };
  });
  for (const left of waiting.values()) {
    for (const item of left)
      out.push({ change: "gone", before: item, after: null });
  }
  return out;
}
/** The threads on the requests of one step of a run. */
export function requestNotes(
  comments: RowComment[],
  run: string,
  step: number,
): RowComment[] {
  return comments.filter(
    (comment) =>
      comment.kind === "step" &&
      comment.run === run &&
      comment.step === step &&
      comment.request !== null,
  );
}

/** Whether a thread is on `request`. */
export function isOnRequest(
  comment: RowComment,
  request: { method: string; url: string },
): boolean {
  return (
    comment.kind === "step" &&
    comment.request?.method === request.method &&
    comment.request.url === request.url
  );
}
// ~/~ end
