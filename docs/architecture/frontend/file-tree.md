# File tree

A diff with a handful of files reads fine top to bottom. One with dozens
does not: a reader who wants `src/server.ts` has to scroll past everything
that sorts before it. This is the summary that answers "what changed" before
the patch does, and the navigator that jumps straight to a file from
anywhere in it. Both draw the same folded tree, so a reader learns its shape
once.

## Folding a diff's files into a tree

`FileDiff` names a file by its wire shape: `path` for an add, a delete, or
an edit, `oldPath`/`newPath` for a rename or a copy. Every reader of the
tree wants the same few facts regardless of which shape they came from, so
`ChangedFile` is that shape read once, up front, rather than a union every
caller re-narrows.

`anchor` is the DOM id of the file's own `<section>` in the diff below. It
is what the tree and the navigator jump to, and `fileAnchor` is the one
function that spells it: a scope (the row a comparison sits in, or the
commit a stack row is) and the file's own after-side path, so the same file
in two different rows still gets two different ids.

```ts
//| id: frontend-view-changed-files
//| file: src/frontend/views/changedFiles.ts
import type { FileDiff } from "../api";
import type { FileVersion, RowComment } from "../state/review";
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

/** The file as a viewed mark names it: filed like its comments, and pinned
 *  to the blobs it was read at. */
export function fileVersionOf(file: FileDiff): FileVersion {
  return {
    path: shownPathOf(file),
    oldBlob: file.oldBlob,
    newBlob: file.newBlob,
  };
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
```

The backend sends files in path order, so a tree built without sorting
already reads in that order, depth first. That is also the order the diff
itself draws its files in, so a tree's leaves, the diff's own order, and
the order `Prev`/`Next` step through agree by construction rather than by a
sort the three would otherwise have to share.

`fileTree` builds the un-folded tree first, one folder per path segment,
keyed in a `Map` so each folder keeps the order its children first
appeared in. Folding is a second pass: a folder whose only child is another
folder is the same row as that child, chained under one name, so it
collapses; a folder whose only child is a file is not, because a file is
never folded into anything.

```ts
//| id: frontend-view-changed-files

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
```

### Test

```ts
//| id: frontend-view-changed-files-test
//| file: src/frontend/views/changedFiles.test.ts
import { describe, expect, test } from "bun:test";
import type { FileDiff } from "../api";
import type { RowComment } from "../state/review";
import {
  type ChangedFile,
  changedFile,
  changedFilesOf,
  fileAnchor,
  fileTree,
  shownPathOf,
} from "./changedFiles";

const PATCH = ["@@ -1,2 +1,3 @@", " keep", "-old", "+new", "+another"].join(
  "\n",
);

function added(path: string, patch = PATCH): FileDiff {
  return {
    status: "added",
    path,
    binary: false,
    oldBlob: null,
    newBlob: "b",
    patch,
    structural: { kind: "unavailable", reason: "test fixture" },
  };
}

function renamed(oldPath: string, newPath: string): FileDiff {
  return {
    status: "renamed",
    oldPath,
    newPath,
    binary: false,
    oldBlob: "a",
    newBlob: "b",
    patch: PATCH,
    structural: { kind: "unavailable", reason: "test fixture" },
  };
}

function comment(path: string, resolved: boolean): RowComment {
  return {
    id: `${path}:${String(resolved)}`,
    reviewKey: "row",
    path,
    side: "after",
    line: 1,
    commitId: "c",
    body: "hi",
    resolved,
    createdAt: "2024-01-01T00:00:00Z",
    stale: false,
  };
}

describe("fileTree", () => {
  test("folds a chain of single-folder directories into one row", () => {
    // arrange
    const files = changedFilesOf(
      [added("src/frontend/views/a.ts"), added("src/frontend/views/b.ts")],
      "row",
      [],
    );

    // act
    const tree = fileTree(files);

    // assert
    expect(tree).toEqual([
      {
        kind: "folder",
        name: "src/frontend/views",
        children: [
          { kind: "file", name: "a.ts", file: files[0] as ChangedFile },
          { kind: "file", name: "b.ts", file: files[1] as ChangedFile },
        ],
      },
    ]);
  });

  test("does not fold a folder whose one child is a file", () => {
    // arrange
    const files = changedFilesOf([added("a/b.ts")], "row", []);

    // act
    const tree = fileTree(files);

    // assert
    expect(tree).toEqual([
      {
        kind: "folder",
        name: "a",
        children: [
          { kind: "file", name: "b.ts", file: files[0] as ChangedFile },
        ],
      },
    ]);
  });

  test("keeps children in first-appearance order, not sorted", () => {
    // arrange
    const files = changedFilesOf(
      [added("z.ts"), added("a/two.ts"), added("a/one.ts")],
      "row",
      [],
    );

    // act
    const tree = fileTree(files);

    // assert
    expect(tree.map((node) => node.name)).toEqual(["z.ts", "a"]);
    const folder = tree[1];
    expect(folder?.kind).toBe("folder");
    expect(
      folder?.kind === "folder" ? folder.children.map((c) => c.name) : [],
    ).toEqual(["two.ts", "one.ts"]);
  });

  test("keys a renamed file by its new path", () => {
    // arrange
    // act
    const file = changedFile(
      renamed("old/name.ts", "new/name.ts"),
      "anchor",
      [],
    );

    // assert
    expect(file.path).toBe("new/name.ts");
    expect(file.from).toBe("old/name.ts");
  });

  test("counts added and removed lines from the patch's hunks", () => {
    // arrange
    // act
    const file = changedFile(added("a.ts"), "anchor", []);

    // assert
    expect(file.added).toBe(2);
    expect(file.removed).toBe(1);
  });

  test("counts only unresolved comments on the file's own path", () => {
    // arrange
    const comments = [
      comment("a.ts", false),
      comment("a.ts", true),
      comment("b.ts", false),
    ];

    // act
    const file = changedFile(added("a.ts"), "anchor", comments);

    // assert
    expect(file.openComments).toBe(1);
  });

  test("counts a renamed file's comments under the path its header shows", () => {
    // arrange
    const file = renamed("old.ts", "new.ts");

    // act
    const changed = changedFile(file, "anchor", [
      comment(shownPathOf(file), false),
    ]);

    // assert
    expect(changed.openComments).toBe(1);
  });
});

describe("fileAnchor", () => {
  test("gives the same file two different ids under two scopes", () => {
    // arrange
    // act
    // assert
    expect(fileAnchor("row-1", "a.ts")).not.toBe(fileAnchor("row-2", "a.ts"));
  });
});

describe("shownPathOf", () => {
  test("shows a rename as both of its paths", () => {
    // arrange
    // act
    // assert
    expect(shownPathOf(added("a.ts"))).toBe("a.ts");
    expect(shownPathOf(renamed("old.ts", "new.ts"))).toBe("old.ts → new.ts");
  });
});
```

## The tree view

`FileTree` draws the shape `fileTree` built: a folder is a row that toggles
its own children, a file is a row that reports itself picked. Neither reads
the diff or the page around it, so the same component draws
[the summary card above a diff](diff.md#diff-view) and
[the navigator's own list](#stepping-through-files) without either caring
that the other exists.

A folder starts open, because a reader who has not yet folded anything
should see everything a diff touched, not a tree they must unfold one
level at a time before they can tell what changed. Each folder owns its own
`open` state rather than reading it from a set the caller holds, since
nothing outside one row's own disclosure cares whether it is open.

```tsx
//| id: frontend-view-file-tree
//| file: src/frontend/views/FileTree.tsx
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
```

A row indents by its depth through a custom property rather than a nesting
selector, because the tree's own `<ul>`s already nest one per folder and a
selector keyed to nesting depth would have to repeat itself once per level
the tree could ever reach. Renamed-file colour and deleted-file colour are
role tokens, `--status-renamed` and `--diff-removed`, the same way every
other colour in the app names a role rather than a shade.

```css
/*| id: design-file-tree
@layer components {
  .file-tree,
  .file-tree ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .file-tree__row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    min-height: 26px;
    padding: 0 var(--space-4) 0
      calc(var(--space-4) + var(--file-tree-depth, 0) * 14px);
    font: inherit;
    color: inherit;
    text-align: left;
    cursor: pointer;
    background: none;
    border: none;
    border-left: var(--border-width-accent) solid transparent;
  }

  .file-tree__row:hover {
    background: var(--surface-sunken);
  }

  .file-tree__row--current {
    background: var(--surface-selected);
    border-left-color: var(--accent);
  }

  .file-tree__row--current:hover {
    background: var(--surface-selected);
  }

  .file-tree__twisty {
    width: 10px;
    flex: none;
    color: var(--text-faint);
    transition: transform 0.12s;
  }

  .file-tree__row--folder[aria-expanded="false"] .file-tree__twisty {
    transform: rotate(-90deg);
  }

  .file-tree__name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .file-tree__name--deleted {
    color: var(--text-faint);
    text-decoration: line-through;
  }

  .file-tree__row--folder .file-tree__name {
    color: var(--text-muted);
  }

  .file-tree__row--folder .file-tree__name::after {
    content: "/";
    color: var(--text-ghost);
  }

  .file-tree__from {
    color: var(--text-faint);
  }

  .file-tree__status {
    width: 12px;
    flex: none;
    text-align: center;
    font-weight: bold;
  }

  .file-tree__status--added {
    color: var(--diff-added);
  }

  .file-tree__status--deleted {
    color: var(--diff-removed);
  }

  .file-tree__status--modified {
    color: var(--status-modified);
  }

  .file-tree__status--renamed,
  .file-tree__status--copied {
    color: var(--status-renamed);
  }

  .file-tree__badge {
    flex: none;
    padding: 0 5px;
    border-radius: 9px;
    font-size: var(--text-size-small);
    color: var(--review-open);
    background: var(--review-open-surface);
  }

  .file-tree__stat {
    flex: none;
    display: flex;
    gap: var(--space-2);
    font-size: var(--text-size-small);
    font-variant-numeric: tabular-nums;
  }

  .file-tree__stat-added {
    color: var(--diff-added);
  }

  .file-tree__stat-removed {
    color: var(--diff-removed);
  }

  .file-tree__stat-bin {
    color: var(--text-faint);
  }
}
```

A row is a touch target as much as it is a click target, and 26px is
comfortable for a mouse but not for a thumb. Under the narrow breakpoint
[Layout](layout.md) already draws the whole page at, a row grows to 40px,
the minimum an accessibility guideline signs off on.

```css
/*| id: design-file-tree
@layer components-narrow {
  @media (max-width: 1000px) {
    .file-tree__row {
      min-height: 40px;
    }
  }
}
```

## Stepping through files

The [summary card](diff.md#diff-view) says what changed; it does not help a
reader who is mid-patch and wants the next file without scrolling back up
for it. `FileNavigator` is a bar [`DiffPane`](diff.md#diff-pane-controller)
renders alongside `InterdiffRows`, once the comparison has more than one
file across every row put together: a step back, a step forward, and a
middle button that opens the same kind of tree the summary draws, this time
grouped by row.

A comparison's own files already have anchors, [scoped per row](#folding-a-diffs-files-into-a-tree)
the same way `DiffView` scopes them, so the navigator is handed the same
`ChangedFile[]` per row rather than the raw `FileDiff[]` it would otherwise
have to re-derive. `DiffPane` builds that list once, keyed by `rowKey`, the
same key `InterdiffRows` already scopes each row's `DiffView` under, so a
file the navigator names and the file its click lands on are always the
same section.

```tsx
//| id: frontend-view-file-navigator
//| file: src/frontend/views/FileNavigator.tsx
import { type RefObject, useEffect, useRef, useState } from "react";
import { type ChangedFile, fileTree } from "./changedFiles";
import { FileTree } from "./FileTree";

/** One row's files, headed by its own label once there is more than one
 *  row to tell apart. */
export interface FileNavigatorGroup {
  label: string | null;
  files: ChangedFile[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function matches(file: ChangedFile, query: string): boolean {
  return query === "" || file.path.toLowerCase().includes(query.toLowerCase());
}

export function FileNavigator({ groups }: { groups: FileNavigatorGroup[] }) {
  const root = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");

  const files = groups.flatMap((group) => group.files);
  const index = Math.max(
    0,
    files.findIndex((file) => file.anchor === current),
  );
  const currentFile = files[index] ?? null;

  useCurrentFile(root, files, setCurrent);
  useCloseOnEscape(open, () => setOpen(false));

  const jumpTo = (file: ChangedFile) => {
    document.getElementById(file.anchor)?.scrollIntoView({ block: "start" });
    setOpen(false);
  };
  const step = (delta: number) => {
    const next = files[clamp(index + delta, 0, files.length - 1)];
    if (next !== undefined) jumpTo(next);
  };

  const visibleGroups = groups
    .map((group) => ({
      ...group,
      files: group.files.filter((file) => matches(file, filter)),
    }))
    .filter((group) => group.files.length > 0);

  return (
    <div className="file-navigator" ref={root}>
      <div className="file-navigator__bar">
        <button
          type="button"
          className="file-navigator__step"
          aria-label="Previous file"
          onClick={() => step(-1)}
        >
          ‹
        </button>
        <button
          type="button"
          className="file-navigator__open"
          aria-label="Show changed files"
          aria-expanded={open}
          onClick={() => setOpen((was) => !was)}
        >
          <span className="file-navigator__pos">
            {files.length === 0 ? "0 / 0" : `${index + 1} / ${files.length}`}
          </span>
          <span className="file-navigator__path">
            {`\u200e${currentFile?.path ?? ""}`}
          </span>
        </button>
        <button
          type="button"
          className="file-navigator__step"
          aria-label="Next file"
          onClick={() => step(1)}
        >
          ›
        </button>
      </div>
      {open && (
        <>
          <button
            type="button"
            className="file-navigator__scrim"
            aria-label="Close changed files"
            onClick={() => setOpen(false)}
          />
          <div
            className="file-navigator__sheet"
            role="dialog"
            aria-label="Changed files"
          >
            <div className="file-navigator__sheet-handle" />
            <div className="file-navigator__sheet-head">
              <input
                type="text"
                className="file-navigator__filter"
                placeholder="Filter files…"
                aria-label="Filter files"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
              />
            </div>
            <div className="file-navigator__sheet-body">
              {visibleGroups.map((group, at) => (
                <div key={group.label ?? at} className="file-navigator__group">
                  {group.label !== null && (
                    <div className="file-navigator__group-label">
                      {group.label}
                    </div>
                  )}
                  <FileTree
                    nodes={fileTree(group.files)}
                    current={current}
                    onPick={jumpTo}
                  />
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
```

The current file is the last one whose top has scrolled above a reading
line near the top of the scroll container, and at the very bottom of the
scroll the last file is current outright, since a short final file might
never cross the line on its own. One scroll listener does this for the
whole bar: a `ref` on the bar's own wrapper finds `.pane--diff`, [the flex
column `.pane--diff` already scrolls as](layout.md#the-pane-rules), by
walking up from an element the effect actually has a handle on, rather than
assuming a container the bar never renders. The listener is attached to
`document` with capture on, because a `scroll` event does not bubble but a
capturing listener still sees it on the way down regardless, and a
`requestAnimationFrame` throttle keeps a fast scroll from recomputing every
file's position on every event.

```tsx
//| id: frontend-view-file-navigator

const READING_LINE = 60;

function useCurrentFile(
  root: RefObject<HTMLDivElement | null>,
  files: ChangedFile[],
  setCurrent: (anchor: string | null) => void,
) {
  useEffect(() => {
    const container = root.current?.closest(".pane--diff");
    if (!(container instanceof HTMLElement)) return;

    let frame: number | null = null;
    const recompute = () => {
      frame = null;
      const elements = files
        .map((file) => document.getElementById(file.anchor))
        .filter((element): element is HTMLElement => element !== null);
      if (elements.length === 0) return;

      const containerTop = container.getBoundingClientRect().top;
      let at = 0;
      elements.forEach((element, position) => {
        if (
          element.getBoundingClientRect().top - containerTop <=
          READING_LINE
        ) {
          at = position;
        }
      });
      if (
        container.scrollTop + container.clientHeight >=
        container.scrollHeight - 2
      ) {
        at = elements.length - 1;
      }
      setCurrent(files[at]?.anchor ?? null);
    };

    const onScroll = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(recompute);
    };

    recompute();
    document.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("scroll", onScroll, true);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [root, files, setCurrent]);
}

function useCloseOnEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
}
```

The middle button opens the same list either as a popover or as a bottom
sheet, and which one it is is a media query, not a branch: both are the one
`.file-navigator__sheet`, and the narrow rule repositions it instead of a
second component drawing it a second way. On a wide screen the bar sits
above the diff, sticky to the top of `.pane--diff`; on a phone it moves to
the bottom edge, in thumb reach, by giving it `order: 2` in the same flex
column and switching `top: 0` for `bottom: 0`. `DiffPane` renders the bar
once, before `InterdiffRows`, and the two rules are what move it without
either component knowing the other exists.

The path is truncated from the left, so the file's own name survives a long
directory and not the other way around. `direction: rtl` truncates that
end, and a leading left-to-right mark keeps the path itself reading
forwards despite the container's direction, the same trick a phone's URL
bar uses to keep a domain visible ahead of a long path.

On a wide pane the bar holds the top of `.pane--diff`, so a jump to a file
has to stop below it rather than put the file's first lines under it. The
bar has a fixed height, and a pane holding a navigator hands that height to
the diff as `--diff-sticky-top`, which `.diff-file` takes as its
`scroll-margin-top`. The [summary card](diff.md#diff-view) jumps to the
same sections and stops at the same offset. On a phone the bar is at the
bottom, so the offset is zero.

```css
/*| id: design-file-navigator
@layer components {
  .file-navigator {
    position: sticky;
    top: 0;
    z-index: 2;
    flex: none;
  }

  .pane--diff:has(> .file-navigator) {
    --file-navigator-height: calc(
      var(--text-size) *
      var(--text-line-height) +
      2 *
      var(--space-3) +
      1px
    );
    --diff-sticky-top: var(--file-navigator-height);
  }

  .file-navigator__bar {
    box-sizing: border-box;
    height: var(--file-navigator-height);
    display: flex;
    align-items: stretch;
    background: var(--surface-raised);
    border-bottom: 1px solid var(--border);
  }

  .file-navigator__step {
    flex: none;
    padding: var(--space-3) var(--space-5);
    font: inherit;
    font-size: 14px;
    color: var(--text-muted);
    cursor: pointer;
    background: none;
    border: none;
  }

  .file-navigator__step:hover {
    background: var(--surface-sunken);
  }

  .file-navigator__open {
    flex: 1;
    min-width: 0;
    display: flex;
    gap: var(--space-4);
    align-items: center;
    padding: var(--space-3) var(--space-5);
    font: inherit;
    color: inherit;
    text-align: left;
    cursor: pointer;
    background: none;
    border: none;
  }

  .file-navigator__open:hover {
    background: var(--surface-sunken);
  }

  .file-navigator__pos {
    flex: none;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }

  .file-navigator__path {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    direction: rtl;
    font-weight: bold;
  }

  .file-navigator__scrim {
    position: fixed;
    z-index: 3;
    inset: 0;
    padding: 0;
    border: none;
    background: transparent;
  }

  .file-navigator__sheet {
    position: absolute;
    z-index: 4;
    top: 36px;
    left: var(--space-5);
    width: 380px;
    max-height: 70vh;
    display: flex;
    flex-direction: column;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-large);
  }

  .file-navigator__sheet-handle {
    display: none;
  }

  .file-navigator__sheet-head {
    flex: none;
    padding: var(--space-4);
    border-bottom: 1px solid var(--border-subtle);
  }

  .file-navigator__filter {
    box-sizing: border-box;
    width: 100%;
    padding: var(--space-3) var(--space-4);
    font: inherit;
    color: var(--text);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }

  .file-navigator__sheet-body {
    flex: 1;
    overflow-y: auto;
    padding: var(--space-2) 0 var(--space-4);
  }

  .file-navigator__group-label {
    padding: var(--space-3) var(--space-4) var(--space-2);
    color: var(--text-faint);
    font-size: var(--text-size-small);
  }
}
```

Under the narrow breakpoint the bar changes edge and the sheet changes
shape, and nothing else about either moves: the same elements, the same
handlers, two rules apart.

```css
/*| id: design-file-navigator
@layer components-narrow {
  @media (max-width: 1000px) {
    .file-navigator {
      order: 2;
      top: auto;
      bottom: 0;
    }

    .pane--diff:has(> .file-navigator) {
      --diff-sticky-top: 0;
    }

    .file-navigator__bar {
      height: 52px;
      border-bottom: none;
      border-top: 1px solid var(--border);
    }

    .file-navigator__sheet {
      top: auto;
      right: 0;
      bottom: 0;
      left: 0;
      width: auto;
      max-height: 80dvh;
      border-width: 1px 0 0;
      border-radius: var(--radius-large) var(--radius-large) 0 0;
    }

    .file-navigator__sheet-handle {
      display: block;
      width: 36px;
      height: 4px;
      margin: var(--space-4) auto 0;
      background: var(--border);
      border-radius: 2px;
    }

    .file-navigator__scrim {
      background: color-mix(in srgb, var(--text) 35%, transparent);
    }
  }
}
```
