// ~/~ begin <<docs/architecture/frontend/components.md#frontend-view-components-peek>>[init]
import type { ReactNode } from "react";
import type { AsyncState } from "../../model/asyncState";
import {
  type Component,
  placeAt,
  type Reference,
  type RowTrees,
} from "../../model/components";
import type { FileDiff } from "../../model/diff";
import { type HunkLine, readPatch } from "../../model/patch";
import type { Comment } from "../../model/review";
import type { SourceFile, SourceLookup, SyntaxToken } from "../../model/source";
import { sidesOf } from "../DiffView/FileRow/drawnLines";

/** What a peek shows: a component's lines in some diff, its threads, or
 *  the lines that use it. */
export type Peeked =
  | {
      kind: "lines";
      title: string;
      note: string;
      component: Component;
      files: AsyncState<FileDiff[]>;
      trees: RowTrees;
      path: string;
      x: number;
      /** Just below the trigger, and just above it. */
      y: number;
      above: number;
    }
  | {
      kind: "threads";
      component: Component;
      comments: Comment[];
      versionOf: (commitId: string) => string;
      /** Goes to where a thread sits, or null when this comparison does not
       *  draw its line. */
      goTo: (comment: Comment) => (() => void) | null;
      x: number;
      /** Just below the trigger, and just above it. */
      y: number;
      above: number;
    }
  | {
      kind: "uses";
      component: Component;
      /** The lines that name it from elsewhere, in drawn order. */
      used: Reference[];
      /** The components its own lines name, and how many lines do. */
      uses: { component: Component; count: number }[];
      onGo: (reference: Reference) => void;
      /** Goes to a component, or null when nothing on screen reaches it. */
      reach: (component: Component) => (() => void) | null;
      x: number;
      /** Just below the trigger, and just above it. */
      y: number;
      above: number;
    };

export function Peek({
  peeked,
  components,
  sources,
  onLeave,
  onClose,
}: {
  peeked: Peeked;
  components: Component[];
  sources: SourceLookup;
  onLeave: () => void;
  onClose: () => void;
}) {
  const width = 600;
  // Below the trigger, unless there is more room above it; either way no
  // taller than the room, so it never covers what was pointed at.
  const below = innerHeight - peeked.y - 8;
  const above = peeked.above - 8;
  const down = below >= Math.min(above, innerHeight * 0.6);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: leaving a peek closes it, as pointing at its trigger opened it
    <div
      className={`components-peek components-kind--${peeked.component.kind}`}
      style={{
        left: Math.max(8, Math.min(peeked.x - 40, innerWidth - width - 20)),
        ...(down
          ? { top: peeked.y, maxHeight: `min(60vh, ${below}px)` }
          : {
              bottom: innerHeight - peeked.above,
              maxHeight: `min(60vh, ${above}px)`,
            }),
      }}
      onMouseLeave={onLeave}
    >
      {peeked.kind === "lines" ? (
        <>
          <div className="components-peek__head">
            <b>{peeked.title}</b>
          </div>
          <div className="components-peek__body">
            {peeked.files.status === "ready" ? (
              <Lines
                components={components}
                files={peeked.files.data}
                trees={peeked.trees}
                id={peeked.component.id}
                path={peeked.path}
                sources={sources}
              />
            ) : (
              <p className="components-peek__wait">
                {peeked.files.status === "error"
                  ? peeked.files.message
                  : "Loading..."}
              </p>
            )}
          </div>
          {peeked.note !== "" && (
            <div className="components-peek__foot">{peeked.note}</div>
          )}
        </>
      ) : peeked.kind === "uses" ? (
        <>
          <div className="components-peek__head">
            <b>{peeked.component.name}</b>
            <span>
              {peeked.used.length} {peeked.used.length === 1 ? "use" : "uses"}{" "}
              in this diff
            </span>
            <button type="button" className="components-chip" onClick={onClose}>
              close ✕
            </button>
          </div>
          <div className="components-peek__body">
            <Uses peeked={peeked} />
          </div>
        </>
      ) : (
        <>
          <div className="components-peek__head">
            <b>{peeked.component.name}</b>
            <span>
              {peeked.comments.length} thread
              {peeked.comments.length === 1 ? "" : "s"}, on any version
            </span>
            <button type="button" className="components-chip" onClick={onClose}>
              close ✕
            </button>
          </div>
          <div className="components-peek__body">
            {peeked.comments.map((comment) => (
              <div key={comment.id} className="components-thread">
                <ThreadHead
                  comment={comment}
                  version={peeked.versionOf(comment.commitId)}
                  onGo={peeked.goTo(comment)}
                />
                {[
                  {
                    id: comment.id,
                    author: comment.author,
                    body: comment.body,
                  },
                  ...comment.replies,
                ].map((message) => (
                  <div key={message.id} className="components-thread__message">
                    <b
                      className={
                        message.author === "reader"
                          ? undefined
                          : "components-thread__other"
                      }
                    >
                      {message.author === "reader" ? "you" : message.author}
                    </b>{" "}
                    {message.body}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** Who uses a component, by the component each line sits in, and what it
 *  uses in turn. */
function Uses({ peeked }: { peeked: Extract<Peeked, { kind: "uses" }> }) {
  const groups = new Map<
    string,
    { component: Component | null; path: string; refs: Reference[] }
  >();
  for (const reference of peeked.used) {
    const component = reference.from?.component ?? null;
    // Lines no component owns group by file.
    const key = component?.id ?? `file:${reference.path}`;
    const group = groups.get(key) ?? {
      component,
      path: reference.path,
      refs: [],
    };
    group.refs.push(reference);
    groups.set(key, group);
  }
  return (
    <div className="components-uses">
      <div className="components-uses__section">Used by</div>
      {[...groups].map(([key, group]) => (
        <div key={key}>
          <div
            className={`components-uses__group${group.component === null ? "" : ` components-kind--${group.component.kind}`}`}
          >
            {group.component !== null && (
              <span className="components-heading__kind">
                {group.component.kind}
              </span>
            )}
            <b>{group.component?.name ?? group.path.split("/").pop()}</b>
            <span className="components-uses__count">×{group.refs.length}</span>
          </div>
          {group.refs.map((reference) => (
            <button
              type="button"
              key={`${reference.path}:${reference.line}`}
              className="components-uses__line"
              title={`${reference.path}:${reference.line}`}
              onClick={() => peeked.onGo(reference)}
            >
              <span className="components-uses__where">
                {reference.added ? "+" : " "}
                {reference.path.split("/").pop()}:{reference.line}
              </span>
              <UsedCode reference={reference} />
            </button>
          ))}
        </div>
      ))}
      {peeked.uses.length > 0 && (
        <>
          <div className="components-uses__section">Uses</div>
          <div className="components-uses__uses">
            {peeked.uses.map(({ component, count }) => {
              const go = peeked.reach(component);
              return (
                <button
                  type="button"
                  key={component.id}
                  className={`components-chip components-kind--${component.kind}`}
                  disabled={go === null}
                  onClick={go ?? undefined}
                >
                  <span className="components-heading__kind">
                    {component.kind}
                  </span>{" "}
                  {component.name} <small>×{count}</small>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

/** A using line, with the name it uses in the used component's colour. */
function UsedCode({ reference }: { reference: Reference }) {
  const code = reference.code.trim();
  // Whole, as the name was found, so `Reply` is not lit inside `ReplyList`.
  const name = reference.word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const at = code.search(new RegExp(`(?<![\\w-])${name}(?![\\w-])`));
  if (at < 0) return <code>{code}</code>;
  return (
    <code>
      {code.slice(0, at)}
      <b className={`components-kind--${reference.to.kind}`}>
        {reference.word}
      </b>
      {code.slice(at + reference.word.length)}
    </code>
  );
}

/** Where a thread sits, as a link to it when this comparison draws it. */
function ThreadHead({
  comment,
  version,
  onGo,
}: {
  comment: Comment;
  version: string;
  onGo: (() => void) | null;
}) {
  const where =
    comment.kind === "line"
      ? `${comment.path.split("/").pop()}:${comment.line}`
      : "";
  return (
    <div className="components-thread__head">
      {onGo === null ? (
        where
      ) : (
        <button type="button" className="components-chip" onClick={onGo}>
          {where}
        </button>
      )}{" "}
      · {version} · {comment.resolved ? "resolved" : "open"}
    </div>
  );
}

/** The runs of a component's lines in one file of a diff, with a line of
 *  context either side, the way the diff itself draws them. */
function Lines({
  components,
  files,
  trees,
  id,
  path,
  sources,
}: {
  components: Component[];
  files: FileDiff[];
  trees: RowTrees;
  id: string;
  path: string;
  sources: SourceLookup;
}) {
  const rows: ReactNode[] = [];
  for (const file of files) {
    const before = "path" in file ? file.path : file.oldPath;
    const after = "path" in file ? file.path : file.newPath;
    if (after !== path && before !== path) continue;
    const sides = sidesOf(file, sources);
    for (const hunk of readPatch(file.patch).hunks) {
      const lines = hunk.lines.filter((line) => line.kind !== "note");
      const inside = lines.map((line) => {
        const ref =
          line.kind === "added"
            ? placeAt(components, trees.after, after, line.newLine)
            : line.kind === "removed"
              ? placeAt(components, trees.before, before, line.oldLine)
              : null;
        return ref?.component.id === id;
      });
      const first = inside.indexOf(true);
      if (first === -1) continue;
      const last = inside.lastIndexOf(true);
      if (rows.length > 0) {
        rows.push(
          <div key={`gap-${rows.length}`} className="components-lines__gap">
            ⋯
          </div>,
        );
      }
      for (const line of lines.slice(Math.max(0, first - 1), last + 2)) {
        rows.push(
          <div
            key={rows.length}
            className={`components-lines__line components-lines__line--${line.kind}`}
          >
            <span className="components-lines__number">
              {"oldLine" in line ? (line.oldLine ?? "") : ""}
            </span>
            <span className="components-lines__number">
              {"newLine" in line ? line.newLine : ""}
            </span>
            <span className="components-lines__sign">
              {line.kind === "added"
                ? "+"
                : line.kind === "removed"
                  ? "-"
                  : " "}
            </span>
            <span>
              {tokensOf(sides, line).map((token, index) => (
                <span
                  // biome-ignore lint/suspicious/noArrayIndexKey: a line's tokens never reorder
                  key={index}
                  className={
                    token.kind === null ? undefined : `syntax--${token.kind}`
                  }
                >
                  {token.text}
                </span>
              ))}
            </span>
          </div>,
        );
      }
    }
  }
  return rows.length === 0 ? (
    <p className="components-peek__wait">Nothing of it in that diff.</p>
  ) : (
    <pre className="components-lines">{rows}</pre>
  );
}

/** A line's highlighted tokens, from the side it is on, or its code as one
 *  plain token while that side loads or says something else. */
function tokensOf(
  sides: { old: SourceFile | null; new: SourceFile | null },
  line: Exclude<HunkLine, { kind: "note" }>,
): SyntaxToken[] {
  const tokens =
    line.kind === "removed"
      ? sides.old?.lines[line.oldLine - 1]
      : sides.new?.lines[line.newLine - 1];
  if (tokens?.map((token) => token.text).join("") === line.code) return tokens;
  return [{ text: line.code, kind: null }];
}
// ~/~ end
