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
shot. A step has no boxes.

The two sides are paired by position, since both played the same recipe.
A parent that stopped early has nothing at the later steps, and the viewer
says so the way it does for a capture with no parent.

```ts
//| id: frontend-model-run-steps
//| file: src/frontend/model/runSteps.ts
import type { Capture } from "./evidence";
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
```

## Network and Console

Both panels list the step in focus, the commit's side first and then what
only the parent did, with each line marked new, gone or changed. A parent
that was never played marks nothing, since there is nothing to compare
with. A request's answer opens under it, both sides when they differ, so a
reader can see the response a change altered.

```tsx
//| id: frontend-view-network
//| file: src/frontend/views/Runs/Network.tsx
import { useState } from "react";
import type { Compared } from "../../model/runSteps";
import type { Request } from "../../model/runs";

export function Network({
  label,
  requests,
}: {
  /** The step the requests belong to. */
  label: string;
  requests: Compared<Request>[];
}) {
  const [open, setOpen] = useState<string | null>(null);
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
              </li>
            );
          })}
        </ul>
      )}
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
import type { Compared } from "../../model/runSteps";
import type { Logged } from "../../model/runs";
import { CHANGE_MARK } from "./Network";

export function Console({
  label,
  lines,
}: {
  label: string;
  lines: Compared<Logged>[];
}) {
  return (
    <div className="run-panel">
      <p className="run-panel__step">{label}</p>
      {lines.length === 0 ? (
        <p className="run-panel__none">Nothing written to the console.</p>
      ) : (
        <ul className="run-list">
          {lines.map((each, index) => {
            const line = (each.after ?? each.before) as Logged;
            return (
              <li
                // biome-ignore lint/suspicious/noArrayIndexKey: a console repeats itself, and the lines never reorder
                key={index}
                className={`run-row run-row--${each.change} run-log--${line.level}`}
              >
                <span className="run-row__change">
                  {CHANGE_MARK[each.change]}
                </span>
                <span className="run-log__level">{line.level}</span>
                <span className="run-log__text">{line.text}</span>
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

  .run-row__head,
  .run-row:not(:has(.run-row__head)) {
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
  .run-row:not(:has(.run-row__head)) {
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

## Tests

```ts
//| id: frontend-model-run-steps-test
//| file: src/frontend/model/runSteps.test.ts
import { describe, expect, test } from "bun:test";
import { compareLogged, compareRequests } from "./runSteps";
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
```
