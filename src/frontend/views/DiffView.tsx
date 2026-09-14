// ~/~ begin <<docs/architecture/frontend.md#frontend-view-diff>>[init]
import { type CSSProperties, useState } from "react";
import type { FileDiff } from "../api";
import type { RowComment } from "../state/review";

export function DiffView({
  files,
  comments,
  onAddComment,
  onResolveComment,
  onDropComment,
}: {
  files: FileDiff[];
  comments: RowComment[];
  onAddComment: (path: string, line: number, body: string) => void;
  onResolveComment: (id: string, resolved: boolean) => void;
  onDropComment: (id: string) => void;
}) {
  const [composer, setComposer] = useState<{
    path: string;
    line: number;
  } | null>(null);

  return (
    <div style={{ padding: 12 }}>
      {files.map((file) => {
        const path = pathOf(file);
        return (
          <FileRow
            key={path}
            file={file}
            comments={comments.filter((comment) => comment.path === path)}
            composerLine={composer?.path === path ? composer.line : null}
            onOpenComposer={(line) => setComposer({ path, line })}
            onCancelComposer={() => setComposer(null)}
            onSubmitComposer={(line, body) => {
              onAddComment(path, line, body);
              setComposer(null);
            }}
            onResolveComment={onResolveComment}
            onDropComment={onDropComment}
          />
        );
      })}
    </div>
  );
}

function FileRow({
  file,
  comments,
  composerLine,
  onOpenComposer,
  onCancelComposer,
  onSubmitComposer,
  onResolveComment,
  onDropComment,
}: {
  file: FileDiff;
  comments: RowComment[];
  composerLine: number | null;
  onOpenComposer: (line: number) => void;
  onCancelComposer: () => void;
  onSubmitComposer: (line: number, body: string) => void;
  onResolveComment: (id: string, resolved: boolean) => void;
  onDropComment: (id: string) => void;
}) {
  return (
    <section style={{ marginBottom: 16, border: "1px solid #ccc" }}>
      <header
        style={{
          background: "#f0f0f0",
          padding: "4px 8px",
          fontWeight: "bold",
        }}
      >
        <span style={{ color: "#666", marginRight: 8 }}>{file.status}</span>
        {pathOf(file)}
      </header>
      {file.binary ? (
        <p style={{ padding: 8, fontStyle: "italic", color: "#666" }}>
          Binary file, no textual diff.
        </p>
      ) : (
        <pre style={{ margin: 0, padding: 8, overflowX: "auto" }}>
          {gutterLines(file.patch).map(({ text, afterLine }, index) => (
            <PatchLine
              // biome-ignore lint/suspicious/noArrayIndexKey: static, non-reordering patch lines
              key={index}
              text={text}
              afterLine={afterLine}
              onOpenComposer={onOpenComposer}
            />
          ))}
        </pre>
      )}
      {composerLine !== null && (
        <CommentComposer
          line={composerLine}
          onCancel={onCancelComposer}
          onSubmit={onSubmitComposer}
        />
      )}
      {comments.length > 0 && (
        <div>
          {comments.map((comment) => (
            <CommentThread
              key={comment.id}
              comment={comment}
              onResolve={(resolved) => onResolveComment(comment.id, resolved)}
              onDrop={() => onDropComment(comment.id)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function CommentComposer({
  line,
  onCancel,
  onSubmit,
}: {
  line: number;
  onCancel: () => void;
  onSubmit: (line: number, body: string) => void;
}) {
  const [body, setBody] = useState("");

  return (
    <form
      style={{ padding: 8, borderTop: "1px solid #ccc", background: "#fafafa" }}
      onSubmit={(event) => {
        event.preventDefault();
        if (body.trim() === "") return;
        onSubmit(line, body);
      }}
    >
      <div style={{ color: "#888", marginBottom: 4 }}>line {line}</div>
      <textarea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        rows={3}
        style={{ width: "100%", font: "inherit" }}
      />
      <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
        <button type="submit">comment</button>
        <button type="button" onClick={onCancel}>
          cancel
        </button>
      </div>
    </form>
  );
}

function CommentThread({
  comment,
  onResolve,
  onDrop,
}: {
  comment: RowComment;
  onResolve: (resolved: boolean) => void;
  onDrop: () => void;
}) {
  return (
    <div
      style={{
        borderLeft: `3px solid ${comment.resolved ? "#63b363" : "#a01b1b"}`,
        padding: "6px 8px",
        margin: "4px 8px",
        opacity: comment.resolved ? 0.72 : 1,
      }}
    >
      <div
        style={{ display: "flex", alignItems: "center", gap: 8, color: "#888" }}
      >
        <span>
          {comment.path}:{comment.line} ·{" "}
          {comment.resolved ? "resolved" : "open"}
        </span>
        <button type="button" onClick={() => onResolve(!comment.resolved)}>
          {comment.resolved ? "reopen" : "resolve"}
        </button>
        <button type="button" onClick={onDrop}>
          delete
        </button>
      </div>
      <div>{comment.body}</div>
      {comment.stale && (
        <div style={{ color: "#8a5a00" }}>
          written against {comment.commitId.slice(0, 8)} — that line has since
          been rewritten
        </div>
      )}
    </div>
  );
}

const gutterStyle: CSSProperties = {
  width: 40,
  flex: "none",
  textAlign: "right",
  marginRight: 8,
  color: "#999",
  userSelect: "none",
};

const lineRowStyle: CSSProperties = {
  display: "flex",
  width: "100%",
  margin: 0,
  padding: 0,
  border: "none",
  background: "transparent",
  font: "inherit",
  textAlign: "left",
};

/** A `<button>` when the line has an after-side line to comment on, a `<div>` otherwise — a static line is not interactive, so it is not a button. */
function PatchLine({
  text,
  afterLine,
  onOpenComposer,
}: {
  text: string;
  afterLine: number | null;
  onOpenComposer: (line: number) => void;
}) {
  const body = (
    <>
      <span style={gutterStyle}>{afterLine ?? ""}</span>
      <span style={{ color: lineColor(text) }}>{text === "" ? " " : text}</span>
    </>
  );

  if (afterLine === null) return <div style={lineRowStyle}>{body}</div>;

  return (
    <button
      type="button"
      onClick={() => onOpenComposer(afterLine)}
      style={{ ...lineRowStyle, cursor: "pointer" }}
    >
      {body}
    </button>
  );
}

function pathOf(file: FileDiff): string {
  return "path" in file ? file.path : `${file.oldPath} → ${file.newPath}`;
}

function lineColor(line: string): string | undefined {
  if (line.startsWith("+++ ") || line.startsWith("--- ")) return "#666";
  if (line.startsWith("diff --git ") || line.startsWith("index "))
    return "#666";
  if (line.startsWith("@@")) return "#0969da";
  if (line.startsWith("+")) return "#1a7f37";
  if (line.startsWith("-")) return "#cf222e";
  return undefined;
}

interface GutterLine {
  text: string;
  afterLine: number | null;
}

/** After-side line number per rendered patch line, or null where none applies. */
function gutterLines(patch: string): GutterLine[] {
  let afterLine: number | null = null;

  return patch.split("\n").map((text) => {
    if (
      text === "" ||
      text.startsWith("diff --git ") ||
      text.startsWith("index ") ||
      text.startsWith("--- ") ||
      text.startsWith("+++ ")
    ) {
      return { text, afterLine: null };
    }

    const hunk = text.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk !== null) {
      afterLine = Number(hunk[1]);
      return { text, afterLine: null };
    }

    if (text.startsWith("-")) return { text, afterLine: null };

    if (afterLine === null) return { text, afterLine: null };
    const line = afterLine;
    afterLine += 1;
    return { text, afterLine: line };
  });
}
// ~/~ end
