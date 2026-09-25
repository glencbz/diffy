// ~/~ begin <<docs/architecture/frontend/file-tree.md#frontend-view-file-tree>>[init]
import { type CSSProperties, useState } from "react";
import type { FileDiff } from "../api";
import type { ChangedFile, TreeNode } from "./changedFiles";

const STATUS_LETTER: Record<FileDiff["status"], string> = {
  added: "A",
  deleted: "D",
  modified: "M",
  renamed: "R",
  copied: "C",
};

export function FileTree({
  nodes,
  current,
  onPick,
}: {
  nodes: TreeNode[];
  /** The anchor of the file to highlight, or null to highlight none. */
  current: string | null;
  onPick: (file: ChangedFile) => void;
}) {
  return (
    <ul className="file-tree">
      {nodes.map((node) => (
        <TreeRow
          key={`${node.kind}:${node.name}`}
          node={node}
          depth={0}
          current={current}
          onPick={onPick}
        />
      ))}
    </ul>
  );
}

function TreeRow({
  node,
  depth,
  current,
  onPick,
}: {
  node: TreeNode;
  depth: number;
  current: string | null;
  onPick: (file: ChangedFile) => void;
}) {
  const [open, setOpen] = useState(true);

  if (node.kind === "file") {
    return (
      <li>
        <FileRow
          name={node.name}
          file={node.file}
          depth={depth}
          isCurrent={node.file.anchor === current}
          onPick={onPick}
        />
      </li>
    );
  }

  return (
    <li>
      <button
        type="button"
        className="file-tree__row file-tree__row--folder"
        style={depthStyle(depth)}
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        <span className="file-tree__twisty" aria-hidden="true">
          ▾
        </span>
        <span className="file-tree__name">{node.name}</span>
      </button>
      {open && (
        <ul>
          {node.children.map((child) => (
            <TreeRow
              key={`${child.kind}:${child.name}`}
              node={child}
              depth={depth + 1}
              current={current}
              onPick={onPick}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function FileRow({
  name,
  file,
  depth,
  isCurrent,
  onPick,
}: {
  name: string;
  file: ChangedFile;
  depth: number;
  isCurrent: boolean;
  onPick: (file: ChangedFile) => void;
}) {
  return (
    <button
      type="button"
      className={
        isCurrent
          ? "file-tree__row file-tree__row--file file-tree__row--current"
          : "file-tree__row file-tree__row--file"
      }
      style={depthStyle(depth)}
      title={file.path}
      onClick={() => onPick(file)}
    >
      <span
        className={`file-tree__status file-tree__status--${file.status}`}
        title={file.status}
      >
        {STATUS_LETTER[file.status]}
      </span>
      <span
        className={
          file.status === "deleted"
            ? "file-tree__name file-tree__name--deleted"
            : "file-tree__name"
        }
      >
        {name}
        {file.from !== null && (
          <span className="file-tree__from">
            {" "}
            ← {file.from.split("/").at(-1)}
          </span>
        )}
      </span>
      {file.openComments > 0 && (
        <span className="file-tree__badge">{file.openComments}</span>
      )}
      <span className="file-tree__stat">
        {file.binary ? (
          <span className="file-tree__stat-bin">bin</span>
        ) : (
          <>
            {file.added > 0 && (
              <span className="file-tree__stat-added">+{file.added}</span>
            )}
            {file.removed > 0 && (
              <span className="file-tree__stat-removed">−{file.removed}</span>
            )}
          </>
        )}
      </span>
    </button>
  );
}

function depthStyle(depth: number): CSSProperties {
  return { "--file-tree-depth": depth } as CSSProperties;
}
// ~/~ end
