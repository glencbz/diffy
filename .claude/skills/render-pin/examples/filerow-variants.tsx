// The pin for FileRow's variant props: every combination of review, links
// and fold state, through DiffView and through FileRow itself, whose props
// differ by side.
import type { Pin } from "./pin";

const VIEWS = "src/frontend/views";

export default async function cases({ side, from, render }: Pin) {
  const { DEFAULT_SETTINGS } = await from("src/frontend/model/settings");
  const { DiffView } = await from(`${VIEWS}/DiffView/DiffView`);

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
  const { FileRow } = await from(`${VIEWS}/DiffView/FileRow/FileRow`);
  const fileReview = (composer: unknown, viewed: boolean) => ({
    comments: comments.filter((c) => c.kind !== "comparison"),
    composer,
    onOpenComposer() {},
    onCancelComposer() {},
    onSubmitComposer() {},
    onResolveComment() {},
    onDropComment() {},
    viewed,
    onToggleViewed() {},
  });
  const reviewProps = (composer: unknown, viewed = false) =>
    side === "before"
      ? { review: fileReview(composer, viewed) }
      : { variant: { kind: "review", ...fileReview(composer, viewed) } };
  const plainProps = side === "before" ? {} : { variant: { kind: "plain-diff" } };
  const viewedAll = files.map((f) => ({
    ...f,
    reviewKey: "k",
    viewedAt: "x",
  }));
  for (const layout of ["unified", "split"] as const)
    for (const diffMode of ["structural", "line"] as const) {
      const display = {
        ...DEFAULT_SETTINGS.display,
        diffLayout: layout,
        diffMode,
      };
      const d = `${layout} ${diffMode}`;
      r(`plain ${d}`, <DiffView files={files} sources={sources} scope="a" display={display} />);
      r(`review ${d}`, <DiffView files={files} sources={sources} review={review} scope="b" display={display} />);
      r(`review links file ${d}`, <DiffView files={files} sources={sources} review={review} links={links(null)} reveal={2} scope="c" display={display} />);
      r(`review links line ${d}`, <DiffView files={files} sources={sources} review={review} links={links(5)} scope="c" display={display} />);
      r(`links file ${d}`, <DiffView files={files} sources={sources} links={links(null)} reveal={1} scope="d" display={display} />);
      r(`links line ${d}`, <DiffView files={files} sources={sources} links={links(5)} scope="d" display={display} />);
      for (const [i, file] of files.entries()) {
        r(`row plain ${d} ${i}`, <FileRow file={file} anchor="x" sources={sources} display={display} {...plainProps} />);
        r(`row viewed ${d} ${i}`, <FileRow file={file} anchor="x" sources={sources} display={display} {...reviewProps(null, true)} />);
        r(`row viewed linked ${d} ${i}`, <FileRow file={file} anchor="x" sources={sources} display={display} links={links(null)} {...reviewProps(null, true)} />);
        for (const composer of [
          { kind: "line", path: file.path ?? file.newPath, side: "after", line: 5 },
          { kind: "file", path: file.path ?? file.newPath },
        ])
          r(`row composer ${composer.kind} ${d} ${i}`, <FileRow file={file} anchor="x" sources={sources} display={display} {...reviewProps(composer)} />);
      }
    }
  r(`review viewed`, <DiffView files={files} sources={sources} review={{ ...review, viewed: viewedAll }} scope="e" display={DEFAULT_SETTINGS.display} />);
}
