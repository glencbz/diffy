# Runs on the review screen

How the reader steps through a [run](../backend/runs.md): the
[viewer](viewer.md) shows the step in focus at the parent and at the commit,
and the Network and Console panels show what that step did on each side,
with what the commit changed marked.

## The step in focus

A run's step is shown as a picture capture of that step: its two windows
side by side or laid over each other, with the step's label as what to look
for. Drawing it through the capture's view keeps one way of comparing
pictures, so swipe, fade and difference work on a step as they do on a
shot. A step has no boxes; which components it reached is what the code
shows by the lines it ran.

The two sides are paired by position, since both played the same recipe.
A parent that stopped early has nothing at the later steps, and the viewer
says so the way it does for a capture with no parent.

```ts
//| id: frontend-model-run-steps
//| file: src/frontend/model/runSteps.ts
import type { Capture } from "./evidence";
import type { Anchor, RowComment } from "./review";
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
/** A request or a console line of a step, named by what pairs the two
 *  sides rather than by what the recording answered. */
export interface StepPart {
  request: { method: string; url: string } | null;
  console: Logged | null;
}

/** The anchor of a thread on one part of a step, on the commit's side. */
export function partAnchor(run: string, step: number, part: StepPart): Anchor {
  return { kind: "step", run, step, side: "after", box: null, ...part };
}

/** The threads on the requests and console lines of one step of a run. */
export function partNotes(
  comments: RowComment[],
  run: string,
  step: number,
): RowComment[] {
  return comments.filter(
    (comment) =>
      comment.kind === "step" &&
      comment.run === run &&
      comment.step === step &&
      (comment.request !== null || comment.console !== null),
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

/** Whether a thread is on `line`. A console that writes one line twice
 *  holds the thread on both, since nothing tells them apart. */
export function isOnLogged(comment: RowComment, line: Logged): boolean {
  return (
    comment.kind === "step" &&
    comment.console?.level === line.level &&
    comment.console.text === line.text
  );
}
```

## Network and Console

Both panels list the step in focus, the commit's side first and then what
only the parent did, with each line marked new, gone or changed. A parent
that was never played marks nothing, since there is nothing to compare
with. A request's answer opens under it, both sides when they differ, so a
reader can see the response a change altered.

A request or a console line takes a thread of its own, opened from the
button at the end of its line, the way a line of code does. Its anchor
names the step and the key that pairs the two sides: a request's method and
address, a line's level and text. A place in the list would not do, since a
re-recorded run can fetch or log in another order and the thread should
still find its line.

```tsx
//| id: frontend-view-network
//| file: src/frontend/views/Runs/Network.tsx
import { useState } from "react";
import type { Anchor, RowComment, ThreadReview } from "../../model/review";
import { type Compared, isOnRequest } from "../../model/runSteps";
import type { Request } from "../../model/runs";
import { CommentComposer, CommentThreads } from "../Comments";

/** The threads on the step's requests or console lines, and the anchor a
 *  new one on `part` takes. */
export interface PartNotes<T> {
  review: ThreadReview;
  anchorOf: (part: T) => Anchor;
}

export function Network({
  label,
  requests,
  notes,
}: {
  /** The step the requests belong to. */
  label: string;
  requests: Compared<Request>[];
  /** Null where there is no review to keep comments in. */
  notes: PartNotes<Request> | null;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [composing, setComposing] = useState<string | null>(null);
  return (
    <div className="run-panel">
      <p className="run-panel__step">{label}</p>
      {requests.length === 0 ? (
        <p className="run-panel__none">No requests in this step.</p>
      ) : (
        <ul className="run-list">
          {requests.map((each, index) => {
            const request = (each.after ?? each.before) as Request;
            const key = `${index}:${request.method} ${request.url}`;
            const body = each.after?.body ?? each.before?.body ?? null;
            const threads =
              notes?.review.comments.filter((comment) =>
                isOnRequest(comment, request),
              ) ?? [];
            return (
              <li key={key} className={`run-row run-row--${each.change}`}>
                <button
                  type="button"
                  className="run-row__head"
                  aria-expanded={open === key}
                  disabled={body === null}
                  onClick={() => setOpen(open === key ? null : key)}
                >
                  <span className="run-row__change">
                    {CHANGE_MARK[each.change]}
                  </span>
                  <span className="run-row__method">{request.method}</span>
                  <span className="run-row__url">{request.url}</span>
                  <span className="run-row__status">
                    {each.change === "changed"
                      ? `${status(each.before)} → ${status(each.after)}`
                      : status(each.after ?? each.before)}
                  </span>
                  <span className="run-row__type">{request.type}</span>
                </button>
                {notes !== null && (
                  <CommentButton
                    count={threads.length}
                    what={`${request.method} ${request.url}`}
                    onClick={() => setComposing(key)}
                  />
                )}
                {open === key && (
                  <div className="run-row__bodies">
                    {each.change === "changed" &&
                    each.before?.body !== each.after?.body ? (
                      <>
                        <Body title="parent" text={each.before?.body ?? null} />
                        <Body
                          title="this commit"
                          text={each.after?.body ?? null}
                        />
                      </>
                    ) : (
                      <Body title={null} text={body} />
                    )}
                  </div>
                )}
                {notes !== null && (
                  <RowNotes
                    review={notes.review}
                    threads={threads}
                    composing={
                      composing === key ? notes.anchorOf(request) : null
                    }
                    onDone={() => setComposing(null)}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** The button at the end of a row: how many threads it holds, or a way to
 *  start one. */
export function CommentButton({
  count,
  what,
  onClick,
}: {
  count: number;
  what: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="run-row__comment"
      aria-label={`comment on ${what}`}
      onClick={onClick}
    >
      {count > 0 ? count : "+"}
    </button>
  );
}

/** The threads under a row, and the composer while the reader writes one. */
export function RowNotes({
  review,
  threads,
  composing,
  onDone,
}: {
  review: ThreadReview;
  threads: RowComment[];
  /** The anchor being written on, or null. */
  composing: Anchor | null;
  onDone: () => void;
}) {
  if (composing === null && threads.length === 0) return null;
  return (
    <div className="run-row__notes">
      {composing !== null && (
        <CommentComposer
          anchor={composing}
          onCancel={onDone}
          onSubmit={(anchor, text) => {
            review.onAddComment(anchor, text);
            onDone();
          }}
        />
      )}
      <CommentThreads
        comments={threads}
        onEditComment={review.onEditComment}
        onResolveComment={review.onResolveComment}
        onDropComment={review.onDropComment}
        onReplyToComment={review.onReplyToComment}
        onEditReply={review.onEditReply}
        onDropReply={review.onDropReply}
      />
    </div>
  );
}

const status = (request: Request | null) =>
  request === null ? "" : (request.status?.toString() ?? "failed");

function Body({ title, text }: { title: string | null; text: string | null }) {
  return (
    <figure className="run-body">
      {title !== null && <figcaption>{title}</figcaption>}
      <pre>{text === null ? "no answer kept" : pretty(text)}</pre>
    </figure>
  );
}

/** JSON laid out to read, anything else as it came. */
function pretty(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

export const CHANGE_MARK = {
  same: "",
  new: "+",
  gone: "−",
  changed: "~",
} as const;
```

```tsx
//| id: frontend-view-console
//| file: src/frontend/views/Runs/Console.tsx
import { useState } from "react";
import { type Compared, isOnLogged } from "../../model/runSteps";
import type { Logged } from "../../model/runs";
import {
  CHANGE_MARK,
  CommentButton,
  type PartNotes,
  RowNotes,
} from "./Network";

export function Console({
  label,
  lines,
  notes,
}: {
  label: string;
  lines: Compared<Logged>[];
  /** Null where there is no review to keep comments in. */
  notes: PartNotes<Logged> | null;
}) {
  const [composing, setComposing] = useState<number | null>(null);
  return (
    <div className="run-panel">
      <p className="run-panel__step">{label}</p>
      {lines.length === 0 ? (
        <p className="run-panel__none">Nothing written to the console.</p>
      ) : (
        <ul className="run-list">
          {lines.map((each, index) => {
            const line = (each.after ?? each.before) as Logged;
            const threads =
              notes?.review.comments.filter((comment) =>
                isOnLogged(comment, line),
              ) ?? [];
            return (
              <li
                // biome-ignore lint/suspicious/noArrayIndexKey: a console repeats itself, and the lines never reorder
                key={index}
                className={`run-row run-row--${each.change} run-log--${line.level}`}
              >
                <span className="run-row__head run-row__head--log">
                  <span className="run-row__change">
                    {CHANGE_MARK[each.change]}
                  </span>
                  <span className="run-log__level">{line.level}</span>
                  <span className="run-log__text">{line.text}</span>
                </span>
                {notes !== null && (
                  <>
                    <CommentButton
                      count={threads.length}
                      what={`${line.level} ${line.text}`}
                      onClick={() => setComposing(index)}
                    />
                    <RowNotes
                      review={notes.review}
                      threads={threads}
                      composing={
                        composing === index ? notes.anchorOf(line) : null
                      }
                      onDone={() => setComposing(null)}
                    />
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
```

```css
/*| id: design-runs
@layer components {
  .run-panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
    font-size: var(--text-size-small);
  }

  .run-panel__step {
    margin: 0;
    font-weight: bold;
  }

  .run-panel__none {
    margin: 0;
    color: var(--text-faint);
  }

  .run-list {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .run-row {
    border-bottom: 1px solid var(--border-subtle);
  }

  /* A request's comment button sits at the end of its line; what opens
     under the line takes the whole row. */
  .run-row:has(.run-row__head) {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: baseline;
  }

  .run-row__bodies,
  .run-row__notes {
    grid-column: 1 / -1;
  }

  .run-row__comment {
    min-width: 1.6em;
    padding: 0 var(--space-1);
    font: inherit;
    color: var(--text-faint);
    cursor: pointer;
    background: none;
    border: 1px solid transparent;
    border-radius: var(--radius);
  }

  .run-row__comment:hover {
    color: var(--review-open);
    border-color: var(--review-open);
  }

  .run-row:has(.run-row__notes) .run-row__comment {
    color: var(--review-open);
  }

  .run-row__notes .comment-composer,
  .run-row__notes .comment-thread {
    margin: var(--space-2) 0 var(--space-2) 1.2em;
  }

  .run-row__head {
    display: grid;
    grid-template-columns: 1.2em 4em minmax(0, 1fr) auto auto;
    gap: var(--space-3);
    align-items: baseline;
    width: 100%;
    padding: var(--space-1) 0;
    font: inherit;
    color: var(--text);
    text-align: left;
    background: none;
    border: none;
  }

  .run-row__head:enabled {
    cursor: pointer;
  }

  .run-row__head:enabled:hover {
    background: var(--surface-sunken);
  }

  /* A console line has no method or status; its text takes their room. */
  .run-row__head--log {
    grid-template-columns: 1.2em 4em minmax(0, 1fr);
  }

  .run-row__url,
  .run-log__text {
    overflow-wrap: anywhere;
  }

  .run-row__status,
  .run-row__type,
  .run-log__level {
    color: var(--text-muted);
    white-space: nowrap;
  }

  .run-row__change {
    font-weight: bold;
  }

  .run-row--new .run-row__change {
    color: var(--diff-added);
  }

  .run-row--gone {
    color: var(--text-muted);
    text-decoration: line-through;
  }

  .run-row--changed .run-row__status {
    color: var(--status-modified);
  }

  .run-log--error .run-log__level,
  .run-log--error .run-log__text {
    color: var(--danger);
  }

  .run-log--warn .run-log__level {
    color: var(--status-modified);
  }

  .run-row__bodies {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(14em, 1fr));
    gap: var(--space-3);
    padding: var(--space-2) 0 var(--space-3) 1.2em;
  }

  .run-body {
    margin: 0;
    min-width: 0;
  }

  .run-body figcaption {
    color: var(--text-muted);
  }

  .run-body pre {
    margin: 0;
    padding: var(--space-2);
    overflow: auto;
    max-height: 20em;
    background: var(--surface-sunken);
    border-radius: var(--radius);
  }
}
```

## The lines a step ran

The code marks the lines the step in focus ran, in the commit's row: a
bar down the right edge of each line, so it never covers the left edge the
[components](components.md) draw on, and a faint tint. The commit's lines
are its own; the parent's are the removed side of the same row, since a
commit's row compares it with its parent.

The marks are one stylesheet, written from the step's lines and replaced
when the focus moves to another step. Classes on the lines themselves
would draw every file of the row again on each step; a stylesheet changes
nothing the diff drew, and the browser restyles only the lines it names.
A line the diff does not draw, such as one far from any change, has no
mark to show.

The viewer says so under the steps, with a swatch of the mark and the files
the step ran, since a bar nobody explained reads as one more highlight.

```ts
//| id: frontend-model-ran-lines
//| file: src/frontend/model/ranLines.ts
import type { Ran } from "./runs";

/** The rules that mark, in the row of `commitId`, the lines a step ran:
 *  the commit's on the side after it, the parent's on the side before. */
export function ranRules(
  commitId: string,
  after: Ran[],
  before: Ran[] | null,
): string {
  // A JSON string is a quoted CSS string as well.
  const row = `.commit-stack__row[data-commit=${JSON.stringify(commitId)}]`;
  const selectors = (ran: Ran[], side: "after" | "before") =>
    ran.flatMap(({ path, lines }) =>
      lines.flatMap(([start, end]) =>
        Array.from(
          { length: end - start + 1 },
          (_, at) =>
            `${row} .diff-file[data-path=${JSON.stringify(path)}] [data-anchor="${side}:${start + at}"]`,
        ),
      ),
    );
  return [
    ...ruleFor(selectors(after, "after"), "run-ran"),
    ...ruleFor(selectors(before ?? [], "before"), "run-ran-before"),
  ].join("\n");
}

// A bar on the right edge over a faint tint, both drawn as background so
// they sit under the text and leave the borders and shadows other marks
// use alone.
function ruleFor(selectors: string[], mark: string): string[] {
  return selectors.length === 0
    ? []
    : [
        `${selectors.join(",\n")} { background-image: linear-gradient(to left, var(--${mark}) 3px, transparent 3px), linear-gradient(color-mix(in srgb, var(--${mark}) 12%, transparent), color-mix(in srgb, var(--${mark}) 12%, transparent)); }`,
      ];
}
```

```css
/*| id: design-runs
@layer components {
  :root {
    --run-ran: var(--accent);
    --run-ran-before: var(--text-faint);
  }

  .viewer__ran {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    margin: 0;
    color: var(--text-muted);
  }

  .viewer__ran-mark {
    flex: none;
    width: 1.2em;
    height: 0.9em;
    background-image:
      linear-gradient(to left, var(--run-ran) 3px, transparent 3px),
      linear-gradient(
        color-mix(in srgb, var(--run-ran) 12%, transparent),
        color-mix(in srgb, var(--run-ran) 12%, transparent)
      );
  }
}
```

## Tests

```ts
//| id: frontend-model-run-steps-test
//| file: src/frontend/model/runSteps.test.ts
import { describe, expect, test } from "bun:test";
import { ranRules } from "./ranLines";
import type { Anchor, RowComment } from "./review";
import {
  compareLogged,
  compareRequests,
  isOnLogged,
  partAnchor,
  partNotes,
} from "./runSteps";
import type { Request } from "./runs";

const get = (
  url: string,
  status: number | null,
  body: string | null = null,
): Request => ({
  method: "GET",
  url,
  status,
  type: "fetch",
  body,
});

describe("comparing a step's sides", () => {
  test("marks requests new, gone, changed and the same", () => {
    // act
    const compared = compareRequests(
      [get("/a", 200), get("/b", 200), get("/c", 404)],
      [get("/a", 200), get("/c", 200), get("/d", 200)],
    );

    // assert
    expect(
      compared.map((each) => [each.change, (each.after ?? each.before)?.url]),
    ).toEqual([
      ["same", "/a"],
      ["changed", "/c"],
      ["new", "/d"],
      ["gone", "/b"],
    ]);
  });

  test("marks nothing when the parent never played", () => {
    // act
    const compared = compareLogged(null, [{ level: "log", text: "hi" }]);

    // assert
    expect(compared.map((each) => each.change)).toEqual(["same"]);
  });

  test("pairs a repeated line once each", () => {
    // act
    const compared = compareLogged(
      [{ level: "log", text: "tick" }],
      [
        { level: "log", text: "tick" },
        { level: "log", text: "tick" },
      ],
    );

    // assert
    expect(compared.map((each) => each.change)).toEqual(["same", "new"]);
  });
});

describe("marking the lines a step ran", () => {
  test("names each line of each run on its side, in the commit's row", () => {
    // act
    const rules = ranRules("c1", [{ path: "a.js", lines: [[2, 3]] }], null);

    // assert
    expect(rules).toContain(
      '.commit-stack__row[data-commit="c1"] .diff-file[data-path="a.js"] [data-anchor="after:2"]',
    );
    expect(rules).toContain('[data-anchor="after:3"]');
    expect(rules).not.toContain("before:");
  });

  test("marks nothing for a step that ran no lines", () => {
    // act
    const rules = ranRules("c1", [], []);

    // assert
    expect(rules).toBe("");
  });
});

describe("threads on a step's parts", () => {
  const comment = (id: string, anchor: Anchor): RowComment => ({
    id,
    reviewKey: "change:a",
    commitId: "c1",
    body: "",
    resolved: false,
    createdAt: "2026-10-26T00:00:00Z",
    author: "reader",
    replies: [],
    stale: false,
    numberedOn: null,
    ...anchor,
  });
  const warned = { level: "warn" as const, text: "slow theme" };
  const comments = [
    comment(
      "request",
      partAnchor("r", 1, {
        request: { method: "GET", url: "/a" },
        console: null,
      }),
    ),
    comment("line", partAnchor("r", 1, { request: null, console: warned })),
    comment("step", partAnchor("r", 1, { request: null, console: null })),
    comment("other", partAnchor("r", 0, { request: null, console: warned })),
  ];

  test("finds a step's request and console threads, not the step's own", () => {
    // act
    const found = partNotes(comments, "r", 1);

    // assert
    expect(found.map((each) => each.id)).toEqual(["request", "line"]);
  });

  test("puts a console thread on the line with its level and text", () => {
    // arrange
    const [, line] = comments as [RowComment, RowComment];

    // act
    const same = isOnLogged(line, { level: "warn", text: "slow theme" });
    const level = isOnLogged(line, { level: "error", text: "slow theme" });

    // assert
    expect([same, level]).toEqual([true, false]);
  });
});
```
