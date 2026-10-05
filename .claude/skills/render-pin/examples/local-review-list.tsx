// The pin for the local review list: live and forgotten reviews, selected
// or not, with and without a review document to delete and restore in.
import type { Pin } from "./pin";

export default async function cases({ side, from, render }: Pin) {
  const { LocalReviewList } = await from(
    "src/frontend/views/LocalReviewList",
  );

  const version = (revset: string) => ({ revset, commits: [] });
  const review = (name: string, versions: string[]) => ({
    name,
    versions: versions.map(version),
  });
  const reviews = [
    review("one", ["a", "a | b"]),
    review("two", ["c"]),
    review("empty", []),
  ];
  const forgotten = [review("gone", ["d"]), review("old", [])];

  // Two handlers or two nulls on the before side, one variant after.
  const offer = (writable: boolean) =>
    side === "before"
      ? writable
        ? { onForget() {}, onRestore() {} }
        : { onForget: null, onRestore: null }
      : {
          variant: writable
            ? { kind: "writable", onForget() {}, onRestore() {} }
            : { kind: "read-only" },
        };

  for (const writable of [false, true])
    for (const [live, gone] of [
      [reviews, forgotten],
      [reviews, []],
      [[], forgotten],
      [[], []],
    ])
      for (const selected of [null, "two"])
        render(
          `list ${writable} ${live.length} ${gone.length} ${selected}`,
          <LocalReviewList
            reviews={live}
            forgotten={gone}
            selected={selected}
            onSelect={() => {}}
            commits={(v: { revset: string }) => <i>{v.revset}</i>}
            {...offer(writable)}
          />,
        );
}
