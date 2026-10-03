// The pin for PR #90, which nested DiffView and the pull request views and
// gave PullPanes and PullReviewPanes data in place of their list and header
// slots. Its `from` pairs name each view's path before and after.
import type { Pin } from "./pin";

const VIEWS = "src/frontend/views";

export default async function cases({ side, from, render }: Pin) {
  const v = (before: string, after: string) =>
    from(`${VIEWS}/${before}`, `${VIEWS}/${after}`);
  const { DEFAULT_SETTINGS } = await from("src/frontend/model/settings");
  const { DiffView } = await v("DiffView", "DiffView/DiffView");
  const { CommentComposer, CommentThreads } = await v("DiffView", "Comments");
  const { PullPanes } = await v("PullPanes", "PullPanes/PullPanes");
  const { PullReviewPanes } = await v(
    "PullPanes",
    "PullReviewPanes/PullReviewPanes",
  );
  const { PullList } = await v("PullList", "PullPanes/PullList");
  const { PullHeader } = await v("PullHeader", "PullReviewPanes/PullHeader");
  const { PullComparisonPicker } = await v(
    "PullComparisonPicker",
    "PullComparisonPicker",
  );
  const { PullStateChip } = await v("PullStateChip", "PullStateChip");

  const src = (n: number): { language: string; lines: unknown[][] } => ({
    language: "ts",
    lines: Array.from({ length: n }, (_, i) => [
      { text: `const l${i + 1} = ${i + 1};`, kind: i % 2 ? "keyword" : null },
    ]),
  });
  const patch =
    "diff --git a/a.ts b/a.ts\nindex 1..2 100644\n--- a/a.ts\n+++ b/a.ts\n@@ -4,3 +4,3 @@\n const l4 = 4;\n-const l5 = 5;\n+const l5 = 55;\n const l6 = 6;\n\\ No newline at end of file\n";
  const files = [
    {
      status: "modified",
      path: "a.ts",
      binary: false,
      oldBlob: "o1",
      newBlob: "n1",
      patch,
      structural: {
        kind: "structural",
        language: "TypeScript",
        hunks: [
          {
            header: "@@ -4,3 +4,3 @@",
            newStart: 4,
            oldStart: 4,
            lines: [
              {
                kind: "context",
                code: "const l4 = 4;",
                newLine: 4,
                oldLine: 4,
              },
              {
                kind: "removed",
                code: "const l5 = 5;",
                oldLine: 5,
                changes: [{ start: 11, end: 12 }],
              },
              {
                kind: "added",
                code: "const l5 = 55;",
                newLine: 5,
                changes: [{ start: 11, end: 13 }],
              },
            ],
          },
        ],
      },
    },
    {
      status: "renamed",
      oldPath: "b.ts",
      newPath: "c/b.ts",
      binary: false,
      oldBlob: "o2",
      newBlob: "n2",
      patch,
      structural: { kind: "unavailable", reason: "too big" },
    },
    {
      status: "added",
      path: "bin.png",
      binary: true,
      oldBlob: null,
      newBlob: "n3",
      patch: "",
      structural: { kind: "unavailable", reason: "binary" },
    },
    {
      status: "modified",
      path: "package-lock.json",
      binary: false,
      oldBlob: "o4",
      newBlob: "n4",
      patch,
      structural: { kind: "structural", language: "Text", hunks: [] },
    },
  ];
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
    comment({ id: "1", kind: "line", path: "a.ts", side: "after", line: 5 }),
    comment({
      id: "2",
      kind: "line",
      path: "a.ts",
      side: "before",
      line: 5,
      resolved: true,
      stale: true,
    }),
    comment({ id: "3", kind: "file", path: "package-lock.json", stale: true }),
    comment({ id: "4", kind: "comparison" }),
  ];
  const review = {
    comments,
    onAddComment() {},
    onResolveComment() {},
    onDropComment() {},
    viewed: [],
    onToggleViewed() {},
  };
  const links = (line: number | null) => ({
    selected: { path: "a.ts", line },
    href: (s: { path: string; line: number | null }) => `#${s.path}:${s.line}`,
    onFollow() {},
  });
  const sources = (blob: string) =>
    blob.startsWith("n") || blob.startsWith("o") ? src(12) : null;
  const r = render;
  for (const layout of ["unified", "split"] as const)
    for (const diffMode of ["structural", "line"] as const) {
      const display = {
        ...DEFAULT_SETTINGS.display,
        diffLayout: layout,
        diffMode,
      };
      r(
        `diff ${layout} ${diffMode} review`,
        <DiffView
          files={files}
          sources={sources}
          review={review}
          scope="s"
          display={display}
        />,
      );
      r(
        `diff ${layout} ${diffMode} links file`,
        <DiffView
          files={files}
          sources={sources}
          links={links(null)}
          scope="s"
          display={display}
          reveal={1}
        />,
      );
      r(
        `diff ${layout} ${diffMode} links line`,
        <DiffView files={files} links={links(5)} scope="t" display={display} />,
      );
      r(
        `diff ${layout} ${diffMode} single`,
        <DiffView files={files.slice(0, 1)} scope="u" display={display} />,
      );
    }
  for (const anchor of [
    { kind: "line", path: "a", side: "after", line: 3 },
    { kind: "line", path: "a", side: "before", line: 3 },
    { kind: "file", path: "a" },
    { kind: "comparison" },
  ])
    r(
      `composer ${JSON.stringify(anchor)}`,
      <CommentComposer
        anchor={anchor}
        onCancel={() => {}}
        onSubmit={() => {}}
      />,
    );
  r(
    "threads",
    <CommentThreads
      comments={comments}
      onResolveComment={() => {}}
      onDropComment={() => {}}
    />,
  );
  r(
    "threads empty",
    <CommentThreads
      comments={[]}
      onResolveComment={() => {}}
      onDropComment={() => {}}
    />,
  );
  const pull = {
    number: 7,
    title: "T",
    state: "MERGED",
    author: "a",
    updatedAt: "x",
    headRefOid: "h",
    baseRefName: "main",
    url: "u",
  };
  const pulls = [pull, { ...pull, number: 8, state: "OPEN" }];
  for (const choice of [
    { phase: "browsing" },
    { phase: "reviewing", pull },
    { phase: "picking", pull },
  ])
    r(
      `panes ${choice.phase}`,
      <PullPanes
        choice={choice}
        onOpen={() => {}}
        onDismiss={() => {}}
        {...(side === "before"
          ? {
              list: (
                <PullList
                  pulls={pulls}
                  selected={
                    choice.phase === "browsing" ? null : choice.pull.number
                  }
                  onSelect={() => {}}
                />
              ),
            }
          : { pulls, onSelect: () => {} })}
        review={<i>R</i>}
      />,
    );
  for (const [position, size] of [
    [{ index: null, count: 1, summary: "s" }, null],
    [{ index: 0, count: 3, summary: "s" }, 200],
    [{ index: 2, count: 3, summary: "s" }, null],
    [{ index: null, count: 0, summary: "" }, 10],
  ] as const)
    r(
      `review panes ${JSON.stringify(position)} ${size}`,
      <PullReviewPanes
        {...(side === "before"
          ? { header: <PullHeader pull={pull} /> }
          : { pull })}
        picker={<i>P</i>}
        commits={<i>C</i>}
        diff={<i>D</i>}
        position={position}
        onStep={() => {}}
        size={size}
        onResize={() => {}}
      />,
    );
  r(
    "list",
    <PullList
      pulls={[pull, { ...pull, number: 8, state: "OPEN" }]}
      selected={8}
      onSelect={() => {}}
    />,
  );
  r("header", <PullHeader pull={{ ...pull, state: "CLOSED" }} />);
  r("chip", <PullStateChip state="OPEN" />);
  const history = {
    number: 7,
    baseRefName: "main",
    baseRefOid: "0123456789",
    truncated: true,
    states: [
      { version: 1, head: "aaa", origin: { kind: "opened" } },
      {
        version: 2,
        head: "bbb",
        origin: { kind: "force-pushed", at: "2026-01-02T00:00:00Z" },
      },
      { version: 3, head: "ccc", origin: { kind: "current" } },
    ],
  };
  for (const baseline of [{ kind: "base" }, { kind: "version", head: "aaa" }])
    for (const filesState of [
      { status: "loading" },
      { status: "ready", data: files },
    ])
      r(
        `picker ${baseline.kind} ${filesState.status}`,
        <PullComparisonPicker
          history={history}
          from={baseline}
          to="ccc"
          files={filesState}
          onPickFrom={() => {}}
          onPickTo={() => {}}
        />,
      );
}
