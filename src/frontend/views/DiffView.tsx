// ~/~ begin <<docs/architecture/frontend.md#frontend-view-diff>>[init]
import type { FileDiff } from "../api";

export function DiffView({ files }: { files: FileDiff[] }) {
  return (
    <div style={{ padding: 12 }}>
      {files.map((file) => (
        <FileRow key={pathOf(file)} file={file} />
      ))}
    </div>
  );
}

function FileRow({ file }: { file: FileDiff }) {
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
          {file.patch.split("\n").map((line, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static, non-reordering patch lines
            <div key={index} style={{ color: lineColor(line) }}>
              {line === "" ? " " : line}
            </div>
          ))}
        </pre>
      )}
    </section>
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
// ~/~ end
