// ~/~ begin <<docs/architecture/frontend/diff.md#frontend-view-split>>[init]
/** One row of a side-by-side diff: a line of the file in either column or
 *  both, or something else across the two. */
export type SplitRow<L> =
  | { kind: "pair"; before: L | null; after: L | null }
  | { kind: "across"; line: L };

/** `lines`, in the order a unified diff reads them, laid out in two
 *  columns. */
export function splitRows<L extends { kind: string }>(
  lines: L[],
): SplitRow<L>[] {
  const rows: SplitRow<L>[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] as L;
    if (line.kind === "context") {
      rows.push({ kind: "pair", before: line, after: line });
      index++;
      continue;
    }
    if (line.kind !== "removed" && line.kind !== "added") {
      rows.push({ kind: "across", line });
      index++;
      continue;
    }

    const removed: L[] = [];
    while (lines[index]?.kind === "removed") removed.push(lines[index++] as L);
    const added: L[] = [];
    while (lines[index]?.kind === "added") added.push(lines[index++] as L);
    for (let row = 0; row < Math.max(removed.length, added.length); row++) {
      rows.push({
        kind: "pair",
        before: removed[row] ?? null,
        after: added[row] ?? null,
      });
    }
  }

  return rows;
}
// ~/~ end
