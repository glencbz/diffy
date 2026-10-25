// ~/~ begin <<docs/architecture/frontend/runs.md#frontend-model-ran-lines>>[init]
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
// ~/~ end
