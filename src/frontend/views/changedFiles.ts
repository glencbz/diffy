// ~/~ begin <<docs/architecture/frontend/file-tree.md#frontend-view-changed-files>>[init]
import type { FileDiff } from "../api";
import type { RowComment } from "../state/review";
import { readPatch } from "./patch";

/** One changed file, read once from whichever `FileDiff` shape it came
 *  from, for every reader that only wants to know what changed. */
export interface ChangedFile {
  /** DOM id of the file's `<section>` in the diff below. */
  anchor: string;
  /** The after-side path: `newPath` for a rename or a copy. */
  path: string;
  /** `oldPath` for a rename or a copy, else null. */
  from: string | null;
  status: FileDiff["status"];
  added: number;
  removed: number;
  binary: boolean;
  /** Unresolved comments on `path`. */
  openComments: number;
}

/** A folder's `name` may itself be `a/b/c`: a chain of folders that each
 *  hold one folder and nothing else, folded into the one row that chain
 *  reads as. */
export type TreeNode =
  | { kind: "folder"; name: string; children: TreeNode[] }
  | { kind: "file"; name: string; file: ChangedFile };

/** A DOM id unique to one file within one scope: a comparison row's key, or
 *  a pull request stack's commit id. */
export function fileAnchor(scope: string, path: string): string {
  const slug = (value: string) => value.replace(/[^a-zA-Z0-9_-]+/g, "-");
  return `file-${slug(scope)}-${slug(path)}`;
}

/** The after-side path a `FileDiff` reads under, regardless of its shape. */
export function afterPathOf(file: FileDiff): string {
  return "path" in file ? file.path : file.newPath;
}

/** The path a file's header shows and its comments are filed under:
 *  `old → new` for a rename or a copy. */
export function shownPathOf(file: FileDiff): string {
  return "path" in file ? file.path : `${file.oldPath} → ${file.newPath}`;
}

function countPatch(patch: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const hunk of readPatch(patch).hunks) {
    for (const line of hunk.lines) {
      if (line.kind === "added") added++;
      else if (line.kind === "removed") removed++;
    }
  }
  return { added, removed };
}

/** One `FileDiff` read into a `ChangedFile`, its comments narrowed to the
 *  ones open against it, under the same path the diff files them. */
export function changedFile(
  file: FileDiff,
  anchor: string,
  comments: RowComment[],
): ChangedFile {
  const path = afterPathOf(file);
  const { added, removed } = countPatch(file.patch);
  return {
    anchor,
    path,
    from: "path" in file ? null : file.oldPath,
    status: file.status,
    added,
    removed,
    binary: file.binary,
    openComments: comments.filter(
      (comment) => comment.path === shownPathOf(file) && !comment.resolved,
    ).length,
  };
}

/** A row's files, each read into a `ChangedFile` under one scope. */
export function changedFilesOf(
  files: FileDiff[],
  scope: string,
  comments: RowComment[],
): ChangedFile[] {
  return files.map((file) =>
    changedFile(file, fileAnchor(scope, afterPathOf(file)), comments),
  );
}
// ~/~ end
// ~/~ begin <<docs/architecture/frontend/file-tree.md#frontend-view-changed-files>>[1]

interface MutableFolder {
  kind: "folder";
  name: string;
  children: Map<string, MutableNode>;
}

type MutableNode =
  | MutableFolder
  | { kind: "file"; name: string; file: ChangedFile };

/** `files` folded into a tree, children kept in first-appearance order. */
export function fileTree(files: ChangedFile[]): TreeNode[] {
  const root: MutableFolder = { kind: "folder", name: "", children: new Map() };

  for (const file of files) {
    const parts = file.path.split("/");
    let node = root;
    for (const part of parts.slice(0, -1)) {
      const existing = node.children.get(part);
      if (existing !== undefined && existing.kind === "folder") {
        node = existing;
        continue;
      }
      const folder: MutableFolder = {
        kind: "folder",
        name: part,
        children: new Map(),
      };
      node.children.set(part, folder);
      node = folder;
    }
    const name = parts.at(-1) as string;
    node.children.set(name, { kind: "file", name, file });
  }

  return [...root.children.values()].map(fold);
}

/** Chains a folder into its only child while that child is itself a
 *  folder with nothing beside it, then folds each of the result's own
 *  children the same way. */
function fold(node: MutableNode): TreeNode {
  if (node.kind === "file") return node;

  let folder = node;
  while (folder.children.size === 1) {
    const [only] = folder.children.values();
    if (only === undefined || only.kind !== "folder") break;
    folder = {
      kind: "folder",
      name: `${folder.name}/${only.name}`,
      children: only.children,
    };
  }

  return {
    kind: "folder",
    name: folder.name,
    children: [...folder.children.values()].map(fold),
  };
}
// ~/~ end
