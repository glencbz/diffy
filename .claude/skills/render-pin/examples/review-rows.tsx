// The pin for the rows that carry a review bar: the bar itself, the
// comparison header around it, and the interdiff rows and commit stack that
// draw both, each with and without a review document to write to.
import type { Pin } from "./pin";

const VIEWS = "src/frontend/views";

export default async function cases({ side, from, render }: Pin) {
  const { DEFAULT_SETTINGS } = await from("src/frontend/model/settings");
  const { ReviewBar } = await from(`${VIEWS}/ReviewBar`);
  const { ComparisonHeader } = await from(`${VIEWS}/ComparisonHeader`);
  const { InterdiffRows } = await from(`${VIEWS}/InterdiffRows`);
  const { CommitStack } = await from(`${VIEWS}/CommitStack`);
  const display = DEFAULT_SETTINGS.display;

  const patch =
    "diff --git a/a.ts b/a.ts\nindex 1..2 100644\n--- a/a.ts\n+++ b/a.ts\n@@ -1,2 +1,2 @@\n const a = 1;\n-const b = 2;\n+const b = 3;\n";
  const files = [
    {
      status: "modified",
      path: "a.ts",
      binary: false,
      oldBlob: "o1",
      newBlob: "n1",
      patch,
      structural: { kind: "unavailable", reason: "too big" },
    },
  ];
  const sources = () => null;
  const entry = (id: string, description: string) => ({
    commitId: `${id}0000000000`,
    changeId: `${id}zzzzzzzz`,
    description,
    parents: [],
    author: "Glen",
    timestamp: "2026-01-01T10:00:00Z",
    refs: [],
    markers: [],
  });
  const comment = (over: Record<string, unknown>) => ({
    reviewKey: "k",
    commitId: "abcdef1234567",
    body: "body",
    resolved: false,
    createdAt: "2026-01-01",
    stale: false,
    ...over,
  });
  const comments = [
    comment({ id: "1", kind: "comparison" }),
    comment({ id: "2", kind: "comparison", resolved: true }),
    comment({ id: "3", kind: "line", path: "a.ts", side: "after", line: 2 }),
    comment({ id: "4", kind: "file", path: "a.ts" }),
  ];
  const states = [
    { state: "unseen" },
    { state: "reviewed", seenAt: "x" },
    { state: "changed", seenAt: "x", seenFrom: null, seenTo: null },
  ];
  const kept = (state: unknown, withComments: boolean) => ({
    reviewKey: "k",
    fromCommitId: null,
    toCommitId: null,
    keeps: null,
    review: state,
    comments: withComments ? comments : [],
    viewed: [],
  });
  const actions = {
    markSeen() {},
    addComment() {},
    resolveComment() {},
    dropComment() {},
    toggleViewed() {},
    markReviewed() {},
    keepPairing() {},
    forgetReview() {},
    restoreReview() {},
  };
  const r = render;

  // What the bar offers: two handlers on the before side, one variant after,
  // which the header takes as `bar`.
  const offer = (writable: boolean) =>
    writable
      ? { kind: "writable", onMarkSeen() {}, onComment() {} }
      : { kind: "read-only" };
  const handlers = (writable: boolean) =>
    writable
      ? { onMarkSeen() {}, onComment() {} }
      : { onMarkSeen: null, onComment: null };
  const bar = (writable: boolean) =>
    side === "before" ? handlers(writable) : { variant: offer(writable) };
  const header = (writable: boolean) =>
    side === "before" ? handlers(writable) : { bar: offer(writable) };

  for (const writable of [false, true])
    for (const [s, state] of states.entries())
      for (const withComments of [false, true])
        for (const shown of [[], files]) {
          const n = `${writable} ${s} ${withComments} ${shown.length}`;
          r(
            `bar ${n}`,
            <ReviewBar
              review={kept(state, withComments)}
              files={shown}
              commentLabel="comment here"
              {...bar(writable)}
            />,
          );
        }

  const row = (
    fromId: string | null,
    toId: string | null,
    shown: unknown[],
    state: unknown,
    withComments: boolean,
  ) => ({
    from: fromId === null ? null : entry(fromId, `from ${fromId}\n\nbody`),
    to: toId === null ? null : entry(toId, `to ${toId}`),
    files: shown,
    ...kept(state, withComments),
  });
  const rows = [
    row("a", "b", files, states[0], true),
    row("c", "d", [], states[1], false),
    row(null, "e", [], states[2], true),
    row("f", null, files, states[1], false),
  ];

  for (const writable of [false, true])
    for (const plain of [false, true])
      for (const [i, each] of rows.entries())
        r(
          `header ${writable} ${plain} ${i}`,
          <ComparisonHeader row={each} plain={plain} {...header(writable)} />,
        );

  for (const plain of [false, true]) {
    r(
      `interdiff read-only ${plain}`,
      <InterdiffRows
        rows={rows}
        plain={plain}
        sources={sources}
        review={null}
        display={display}
      />,
    );
    r(
      `interdiff writable ${plain}`,
      <InterdiffRows
        rows={rows}
        plain={plain}
        sources={sources}
        review={actions}
        display={display}
      />,
    );
  }

  const git = (id: string, description: string) => ({
    commitId: `${id}0000000000`,
    parents: [],
    description,
    author: "Glen",
    authoredAt: "2026-01-01T10:00:00Z",
    changeId: `${id}zzzzzzzz`,
  });
  const stackRow = (key: string, kind: string, filesState: unknown) => ({
    key,
    kind,
    commit: git(key, `subject ${key}\n\nbody ${key}`),
    was: kind === "amended" ? git(`${key}w`, `was ${key}`) : null,
    files: filesState,
  });
  const stack = [
    stackRow("a", "amended", { status: "ready", data: files }),
    stackRow("b", "added", { status: "ready", data: [] }),
    stackRow("c", "plain", { status: "loading" }),
    stackRow("d", "reworded", { status: "error", message: "boom" }),
    stackRow("e", "unchanged", { status: "ready", data: files }),
    stackRow("f", "dropped", { status: "ready", data: files }),
  ];
  const links = () => ({
    selected: null,
    href: (s: { path: string; line: number | null }) => `#${s.path}:${s.line}`,
    onFollow() {},
  });
  for (const writable of [false, true])
    for (const open of [new Set<string>(), new Set(["a", "e", "f"])])
      for (const [s, state] of states.entries())
        r(
          `stack ${writable} ${open.size} ${s}`,
          <CommitStack
            rows={stack}
            sources={sources}
            open={open}
            onToggle={() => {}}
            expanded={new Set(["a"])}
            onExpand={() => {}}
            current="b"
            onInView={() => {}}
            reveal={0}
            links={links}
            since="v5"
            reviewOf={() => kept(state, s !== 1)}
            actions={writable ? actions : null}
            display={display}
          />,
        );
}
