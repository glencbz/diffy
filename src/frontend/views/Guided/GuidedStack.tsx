// ~/~ begin <<docs/architecture/frontend/guide.md#frontend-view-guided>>[init]
import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { afterPathOf, fileAnchor } from "../../model/changedFiles";
import type { FileDiff } from "../../model/diff";
import type { Guide } from "../../model/guide";
import {
  covers,
  type GuidedCommit,
  type GuidedFile,
  type GuidedNote,
  guidedCommit,
  ideaOf,
  lineKey,
} from "../../model/guided";
import type { GuideNotes } from "../../model/settings";
import type { StackLayer, StackRow } from "../CommitStack";
import type { LineDecor } from "../DiffView/FileRow/FileRow";
import { NoteCard, NotePeek, NoteTab, type Peeked } from "./Notes";

/** An idea picked out in one commit. */
interface Emphasis {
  commitId: string;
  idea: number;
}

export interface GuidedStackProps {
  rows: StackRow[];
  /** The guide to the version the rows read, if one was written. */
  guide: Guide | undefined;
  /** The row the address names, which the rail describes. */
  current: string | null;
  /** The reader asked for a commit by its number. */
  onPick: (commitId: string) => void;
  notesAt: GuideNotes;
  onNotesAt: (at: GuideNotes) => void;
  /** The stack, drawn with the guide laid over it. */
  children: (layer: StackLayer) => ReactNode;
}

/** A series' commit stack with its guide laid over it: each line in the
 *  colour of the idea the guide puts it in, a tab where each of the guide's
 *  notes is, and a rail beside it with the current commit's ideas and
 *  files. The stack draws and orders everything as it would without a
 *  guide; the guide only colours it. */
export function GuidedStack({
  rows,
  guide,
  current,
  onPick,
  notesAt,
  onNotesAt,
  children,
}: GuidedStackProps) {
  const [emphasis, setEmphasis] = useState<Emphasis | null>(null);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [lit, setLit] = useState<string | null>(null);
  const [peek, setPeek] = useState<Peeked | null>(null);
  const [currentFile, setCurrentFile] = useState<string | null>(null);
  const body = useRef<HTMLDivElement>(null);
  const rail = useRef<HTMLElement>(null);
  const narrow = useNarrow();
  // A phone has no room for a margin, so its notes open under their lines.
  const placed = narrow ? "inline" : notesAt;

  const guided = useMemo(() => {
    const map = new Map<string, GuidedCommit>();
    if (guide === undefined) return map;
    for (const row of rows) {
      if (row.files.status !== "ready") continue;
      const ideas = guide.ideas.filter(
        (idea) => idea.commitId === row.commit.commitId,
      );
      map.set(
        row.key,
        guidedCommit(row.commit.commitId, row.files.data, ideas, {
          beforeSide: row.was === null,
        }),
      );
    }
    return map;
  }, [rows, guide]);

  const allNotes = [...guided.values()].flatMap((commit) => commit.notes);
  const allOpen = allNotes.every((note) => open.has(note.key));
  const currentRow = rows.find((row) => row.key === current) ?? rows[0];
  const railCommit =
    currentRow === undefined ? undefined : guided.get(currentRow.key);
  const emphasisIn = (commitId: string) =>
    emphasis?.commitId === commitId ? emphasis.idea : null;

  const toggle = (key: string) => {
    setPeek(null);
    setOpen((now) => {
      const next = new Set(now);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  };
  const toggleAll = () =>
    setOpen(allOpen ? new Set() : new Set(allNotes.map((note) => note.key)));

  const paneOf = () => body.current?.closest(".pane--diff") ?? null;

  // The rail stays in view as tall as the pane, and the file whose top the
  // reader has scrolled past last is the one being read.
  const latest = useRef({ railCommit, currentRow });
  latest.current = { railCommit, currentRow };
  useEffect(() => {
    const pane = body.current?.closest(".pane--diff");
    if (!(pane instanceof HTMLElement)) return;
    let frame = 0;
    const read = () => {
      frame = 0;
      const { railCommit, currentRow } = latest.current;
      const line = pane.getBoundingClientRect().top + 60;
      let file: string | null = null;
      for (const each of railCommit?.files ?? []) {
        const element = document.getElementById(
          fileAnchor(currentRow?.commit.commitId ?? "", each.path),
        );
        if (element === null || element.getBoundingClientRect().top > line) {
          continue;
        }
        file = each.path;
      }
      setCurrentFile(file);
    };
    const onScroll = () => {
      if (frame === 0) frame = requestAnimationFrame(read);
      setPeek(null);
    };
    const size = new ResizeObserver(() => {
      rail.current?.style.setProperty(
        "--guided-rail-height",
        `${pane.clientHeight}px`,
      );
    });
    size.observe(pane);
    pane.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      size.disconnect();
      pane.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);

  /** Scrolls the next or previous run of changes to the middle. */
  const step = (by: 1 | -1) => {
    const pane = paneOf();
    if (pane === null) return;
    const box = pane.getBoundingClientRect();
    const middle = box.top + pane.clientHeight / 2 + by * 4;
    const starts = [
      ...pane.querySelectorAll<HTMLElement>(
        ".diff-line--added, .diff-line--removed",
      ),
    ].filter((line) => {
      const previous = line.previousElementSibling;
      return (
        previous === null ||
        !(
          previous.classList.contains("diff-line--added") ||
          previous.classList.contains("diff-line--removed")
        )
      );
    });
    const target =
      by === 1
        ? starts.find((line) => line.getBoundingClientRect().top > middle)
        : starts.findLast((line) => line.getBoundingClientRect().top < middle);
    target?.scrollIntoView({ block: "center", behavior: "smooth" });
  };

  // Rebinds each render, so a key reads the state it was pressed in.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable]")) return;
      const digit = Number(event.key);
      const picked = digit >= 1 ? rows[digit - 1] : undefined;
      if (picked !== undefined) onPick(picked.commit.commitId);
      else if (event.key === "j") step(1);
      else if (event.key === "k") step(-1);
      else if (event.key === "c") toggleAll();
      else if (event.key === "m")
        onNotesAt(notesAt === "inline" ? "margin" : "inline");
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const noteParts = {
    open,
    lit,
    onToggle: toggle,
    onLit: setLit,
    onPeek: setPeek,
  };

  const layer: StackLayer = {
    message: (row) => {
      const commit = guided.get(row.key);
      if (commit === undefined) return null;
      return (
        <MessageNotes
          commit={commit}
          emphasis={emphasisIn(commit.commitId)}
          {...noteParts}
        />
      );
    },
    decor: (row) => {
      const commit = guided.get(row.key);
      if (commit === undefined || commit.ideas.length === 0) return undefined;
      return (file) =>
        fileDecor(file, commit, {
          ...noteParts,
          emphasis: emphasisIn(commit.commitId),
          placed,
        });
    },
  };

  return (
    <div className={`guided-body guided-body--${placed}`} ref={body}>
      <aside className="guided-rail" ref={rail}>
        <p className="guided-rail__by guided-faint">
          {guide === undefined
            ? "No guide has been written to this version yet."
            : `Guide by ${guide.author}, ${guide.writtenAt.slice(0, 10)}`}
        </p>
        {allNotes.length > 0 && (
          <div className="guided-bar">
            <span className="guided-faint">notes</span>
            <span className="guided-switch">
              {(["inline", "margin"] as const).map((at) => (
                <button
                  type="button"
                  key={at}
                  aria-pressed={notesAt === at}
                  onClick={() => onNotesAt(at)}
                >
                  {at === "inline" ? "under the lines" : "in the margin"}
                </button>
              ))}
            </span>
            <button type="button" className="guided-button" onClick={toggleAll}>
              {allOpen ? "close all" : `open all ${allNotes.length}`}
            </button>
          </div>
        )}
        {currentRow === undefined ? null : railCommit === undefined ? (
          guide !== undefined && (
            <p className="guided-faint">Loading the commit's diff...</p>
          )
        ) : (
          <Rail
            commit={railCommit}
            emphasis={emphasisIn(railCommit.commitId)}
            currentFile={currentFile}
            onEmphasis={(idea) =>
              setEmphasis(
                idea === null ? null : { commitId: railCommit.commitId, idea },
              )
            }
            onGo={(path) =>
              document
                .getElementById(fileAnchor(railCommit.commitId, path))
                ?.scrollIntoView({ block: "start" })
            }
          />
        )}
      </aside>
      <div className="guided-main">{children(layer)}</div>
      {peek !== null && !open.has(peek.note.key) && (
        <NotePeek peeked={peek} commit={peek.commit} />
      )}
    </div>
  );
}

/** What every note on screen shares: which are open, which one lights its
 *  lines, and how to change either. */
interface NoteParts {
  open: ReadonlySet<string>;
  lit: string | null;
  onToggle: (key: string) => void;
  onLit: (key: string | null) => void;
  onPeek: (peeked: Peeked | null) => void;
}

/** The notes on a commit's message, as tabs, and those open under them. */
function MessageNotes({
  commit,
  emphasis,
  open,
  lit,
  onToggle,
  onLit,
  onPeek,
}: NoteParts & { commit: GuidedCommit; emphasis: number | null }) {
  const notes = commit.notes.filter((note) => note.path === null);
  if (notes.length === 0) return null;
  return (
    <div className="guided-message">
      <div className="guided-message__notes">
        {notes.map((note) => (
          <NoteTab
            key={note.key}
            note={note}
            commit={commit}
            emphasis={emphasis}
            open={open.has(note.key)}
            onToggle={onToggle}
            onPeek={onPeek}
          />
        ))}
        <span className="guided-faint">on the message</span>
      </div>
      {notes
        .filter((note) => open.has(note.key))
        .map((note) => (
          <NoteCard
            key={note.key}
            note={note}
            commit={commit}
            emphasis={emphasis}
            lit={lit === note.key}
            onToggle={onToggle}
            onLit={onLit}
          />
        ))}
    </div>
  );
}

/** What the guide draws on one file: each line in its idea's colour, a tab
 *  on the line each note starts on, and the notes open under their lines
 *  or in the margin. */
function fileDecor(
  file: FileDiff,
  commit: GuidedCommit,
  {
    open,
    lit,
    onToggle,
    onLit,
    onPeek,
    emphasis,
    placed,
  }: NoteParts & { emphasis: number | null; placed: GuideNotes },
): LineDecor {
  const path = afterPathOf(file);
  const notes = commit.notes.filter((note) => note.path === path);
  const at = new Map(
    notes.flatMap((note) =>
      note.anchor === null ? [] : [[lineKey(note.anchor), note] as const],
    ),
  );
  const litCover = notes.find((note) => note.key === lit)?.cover ?? null;
  const owners = commit.files.find((each) => each.path === path)?.owners ?? [];
  const ideas = [...new Set(owners.filter((owner) => owner !== null))].flatMap(
    (owner) => commit.ideas[owner] ?? [],
  );
  const card = (note: GuidedNote, style?: React.CSSProperties) => (
    <NoteCard
      key={note.key}
      note={note}
      commit={commit}
      emphasis={emphasis}
      lit={lit === note.key}
      onToggle={onToggle}
      onLit={onLit}
      style={style}
    />
  );
  const tab = (note: GuidedNote) => (
    <NoteTab
      key={note.key}
      note={note}
      commit={commit}
      emphasis={emphasis}
      open={open.has(note.key)}
      onToggle={onToggle}
      onPeek={onPeek}
    />
  );
  return {
    header: ideas.map((idea) => (
      <span
        key={idea.title}
        className={`guided-dot idea--${idea.colour}`}
        title={idea.title}
      />
    )),
    lineClass: (line) => {
      const owner = ideaOf(commit, path, line);
      const idea = owner === null ? undefined : commit.ideas[owner];
      return [
        idea !== undefined && `guided-line idea--${idea.colour}`,
        emphasis !== null && owner !== emphasis && "guided-line--dim",
        litCover !== null && covers(litCover, line) && "guided-line--lit",
      ]
        .filter(Boolean)
        .join(" ");
    },
    marker: (line) => {
      const note = at.get(lineKey(line.anchor));
      return note === undefined ? null : tab(note);
    },
    under: (anchor) => {
      const note = at.get(lineKey(anchor));
      if (note === undefined || placed !== "inline" || !open.has(note.key)) {
        return null;
      }
      return <div className="diff-file__line-note">{card(note)}</div>;
    },
    above: (drawn) => {
      const away = notes.filter(
        (note) => note.anchor === null || !drawn.has(lineKey(note.anchor)),
      );
      if (away.length === 0) return null;
      return (
        <div className="guided-message guided-message--file">
          <div className="guided-message__notes">
            {away.map(tab)}
            <span className="guided-faint">on lines out of sight</span>
          </div>
          {away.filter((note) => open.has(note.key)).map((note) => card(note))}
        </div>
      );
    },
    aside:
      placed === "margin" ? (
        <Margin
          notes={notes.filter(
            (note) => note.anchor !== null && open.has(note.key),
          )}
          card={card}
        />
      ) : null,
  };
}

/** Space kept between two notes in the margin. */
const MARGIN_GAP = 6;

/** The open notes of one file beside its lines, each level with the line
 *  its tab is on, pushed down only as far as the note above it needs. */
function Margin({
  notes,
  card,
}: {
  notes: GuidedNote[];
  card: (note: GuidedNote, style?: React.CSSProperties) => ReactNode;
}) {
  const margin = useRef<HTMLDivElement>(null);
  const [tops, setTops] = useState<ReadonlyMap<string, number>>(new Map());
  const keys = notes.map((note) => note.key).join(" ");

  // biome-ignore lint/correctness/useExhaustiveDependencies: the lines move when what is open changes
  useLayoutEffect(() => {
    const element = margin.current;
    const file = element?.closest(".diff-file");
    if (element == null || file == null) return;
    const place = () => {
      const base = element.getBoundingClientRect().top;
      const found = notes.flatMap((note) => {
        if (note.anchor === null) return [];
        const line = file.querySelector(
          `[data-anchor="${lineKey(note.anchor)}"]`,
        );
        return line === null
          ? []
          : [{ note, top: line.getBoundingClientRect().top - base }];
      });
      found.sort((a, b) => a.top - b.top);
      const next = new Map<string, number>();
      let floor = 0;
      for (const { note, top } of found) {
        const at = Math.max(top, floor);
        next.set(note.key, at);
        const card = element.querySelector<HTMLElement>(
          `[data-note="${CSS.escape(note.key)}"]`,
        );
        floor = at + (card?.offsetHeight ?? 0) + MARGIN_GAP;
      }
      setTops((now) =>
        now.size === next.size &&
        [...next].every(([key, top]) => now.get(key) === top)
          ? now
          : next,
      );
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(file);
    return () => observer.disconnect();
  }, [keys, tops]);

  return (
    <div className="guided-margin" ref={margin}>
      {notes.map((note) =>
        card(note, {
          top: tops.get(note.key) ?? 0,
          visibility: tops.has(note.key) ? undefined : "hidden",
        }),
      )}
    </div>
  );
}

/** The commit on screen at a glance: its ideas, then each file with a strip
 *  of the ideas its changes belong to. */
function Rail({
  commit,
  emphasis,
  currentFile,
  onEmphasis,
  onGo,
}: {
  commit: GuidedCommit;
  emphasis: number | null;
  currentFile: string | null;
  onEmphasis: (idea: number | null) => void;
  onGo: (path: string) => void;
}) {
  return (
    <>
      {commit.ideas.length > 0 && (
        <>
          <h3 className="guided-rail__head">
            Ideas <span className="guided-faint">click to emphasise one</span>
          </h3>
          {commit.ideas.map((idea, index) => (
            <button
              type="button"
              // biome-ignore lint/suspicious/noArrayIndexKey: a commit's ideas never move
              key={index}
              className={`guided-idea idea--${idea.colour} ${emphasis === index ? "guided-idea--on" : ""} ${emphasis !== null && emphasis !== index ? "guided-idea--off" : ""}`}
              aria-pressed={emphasis === index}
              title={idea.note}
              onClick={() => onEmphasis(emphasis === index ? null : index)}
            >
              <span className="guided-dot" />
              {idea.title}
            </button>
          ))}
        </>
      )}
      <h3 className="guided-rail__head">
        Files <span className="guided-faint">{commit.files.length}</span>
      </h3>
      {commit.files.map((file) => (
        <FileEntry
          key={file.path}
          file={file}
          commit={commit}
          emphasis={emphasis}
          current={currentFile === file.path}
          onGo={() => onGo(file.path)}
        />
      ))}
    </>
  );
}

const NARROW = "(max-width: 760px)";

/** Whether the screen is as narrow as a phone's. */
function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW).matches);
  useEffect(() => {
    const query = window.matchMedia(NARROW);
    const onChange = () => setNarrow(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return narrow;
}

/** A file in the rail: its path, its size, and a strip of the ideas its
 *  changes belong to, grey for changes no idea claims. */
function FileEntry({
  file,
  commit,
  emphasis,
  current,
  onGo,
}: {
  file: GuidedFile;
  commit: GuidedCommit;
  emphasis: number | null;
  current: boolean;
  onGo: () => void;
}) {
  const runs = changeRuns(file.owners);
  const slash = file.path.lastIndexOf("/");
  return (
    <button
      type="button"
      className={`guided-file ${current ? "guided-file--on" : ""} ${runs.every((run) => run.idea === null) ? "guided-file--plain" : ""}`}
      title={file.path}
      onClick={onGo}
    >
      <span className="guided-file__path">
        <span className="guided-faint">{file.path.slice(0, slash + 1)}</span>
        {file.path.slice(slash + 1)}
      </span>
      <span className="guided-file__size">
        <span className="guided-added">+{file.added}</span>{" "}
        <span className="guided-removed">−{file.removed}</span>
      </span>
      <span className="guided-strip">
        {runs.map((run, index) => {
          const idea = run.idea === null ? undefined : commit.ideas[run.idea];
          return (
            <i
              // biome-ignore lint/suspicious/noArrayIndexKey: runs of one file never move
              key={index}
              className={`${idea === undefined ? "guided-strip--plain" : `idea--${idea.colour}`} ${emphasis !== null && run.idea !== emphasis ? "guided-strip--off" : ""}`}
              style={{ flexGrow: run.size }}
            />
          );
        })}
      </span>
    </button>
  );
}

/** A file's changed lines, run by run of the same idea. */
function changeRuns(
  owners: (number | null)[],
): { idea: number | null; size: number }[] {
  const runs: { idea: number | null; size: number }[] = [];
  for (const idea of owners) {
    const last = runs.at(-1);
    if (last !== undefined && last.idea === idea) last.size++;
    else runs.push({ idea, size: 1 });
  }
  return runs;
}
// ~/~ end
