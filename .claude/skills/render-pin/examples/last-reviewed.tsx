// The pin for the last-reviewed line: each baseline against the version
// last reviewed, and the after version marked, markable, or out of reach
// without a review document.
import type { Pin } from "./pin";

export default async function cases({ side, from, render }: Pin) {
  const { LastReviewed } = await from("src/frontend/views/LastReviewed");

  const versions = ["a", "b", "c"].map((id, i) => ({
    id,
    number: i + 1,
  }));
  const marks = ["marked", "unmarked", "unavailable"] as const;
  // A flag and a nullable handler on the before side, one variant after.
  const mark = (kind: (typeof marks)[number]) =>
    side === "before"
      ? {
          toMarked: kind === "marked",
          onMark: kind === "unavailable" ? null : () => {},
        }
      : {
          mark:
            kind === "unmarked" ? { kind, onMark() {} } : { kind },
        };

  for (const kind of marks)
    for (const reviewed of [null, "b", "gone1234567"])
      for (const fromId of [{ kind: "base" }, { kind: "version", id: "b" }])
        for (const to of ["c", "b", "zzzzzzz9"])
          render(
            `${kind} ${reviewed} ${JSON.stringify(fromId)} ${to}`,
            <LastReviewed
              versions={versions}
              reviewed={reviewed}
              from={fromId}
              to={to}
              wholeLabel="the whole thing"
              onWhole={() => {}}
              {...mark(kind)}
            />,
          );
  // Marked with a document to write to draws the same as without one.
  if (side === "before")
    render(
      "marked unavailable",
      <LastReviewed
        versions={versions}
        reviewed="b"
        from={{ kind: "version", id: "b" }}
        to="c"
        wholeLabel="the whole thing"
        onWhole={() => {}}
        toMarked
        onMark={null}
      />,
    );
  else
    render(
      "marked unavailable",
      <LastReviewed
        versions={versions}
        reviewed="b"
        from={{ kind: "version", id: "b" }}
        to="c"
        wholeLabel="the whole thing"
        onWhole={() => {}}
        mark={{ kind: "marked" }}
      />,
    );
}
