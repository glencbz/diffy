// ~/~ begin <<docs/architecture/frontend/guide.md#frontend-view-guided-notes>>[init]
import type { GuidedCommit, GuidedNote } from "../../model/guided";

/** A tab peeked at, the commit it is in, and where it sits on screen. */
export interface Peeked {
  note: GuidedNote;
  commit: GuidedCommit;
  box: DOMRect;
}

const PEEK_WIDTH = 420;

/** Where a note is: the idea's colour and the stop's number in it. Pointing
 *  at it peeks at the note; pressing it keeps the note open. */
export function NoteTab({
  note,
  commit,
  emphasis,
  open,
  onToggle,
  onPeek,
}: {
  note: GuidedNote;
  commit: GuidedCommit;
  emphasis: number | null;
  open: boolean;
  onToggle: (key: string) => void;
  onPeek: (peeked: Peeked | null) => void;
}) {
  const idea = commit.ideas[note.idea];
  if (idea === undefined) return null;
  const show = (element: HTMLElement) =>
    onPeek({ note, commit, box: element.getBoundingClientRect() });
  return (
    <button
      type="button"
      className={`guided-tab idea--${idea.colour} ${open ? "guided-tab--open" : ""} ${emphasis !== null && emphasis !== note.idea ? "guided-tab--off" : ""}`}
      aria-expanded={open}
      aria-label={`${idea.title}, note ${note.stop + 1} of ${idea.stops}`}
      onClick={(event) => {
        // The line it sits on opens a comment when pressed.
        event.stopPropagation();
        onToggle(note.key);
      }}
      onMouseEnter={(event) => show(event.currentTarget)}
      onMouseLeave={() => onPeek(null)}
      onFocus={(event) => show(event.currentTarget)}
      onBlur={() => onPeek(null)}
    >
      {note.stop + 1}
    </button>
  );
}

function NoteHead({
  note,
  commit,
  children,
}: {
  note: GuidedNote;
  commit: GuidedCommit;
  children?: React.ReactNode;
}) {
  const idea = commit.ideas[note.idea];
  return (
    <div className="guided-note__head">
      <span className="guided-dot" />
      <strong className="guided-note__idea">{idea?.title}</strong>
      <span className="guided-faint">
        {note.stop + 1} of {idea?.stops}
      </span>
      {children}
    </div>
  );
}

/** An open note, under the line its tab is on or in the margin beside it.
 *  Pointing at it lights the lines it is about. */
export function NoteCard({
  note,
  commit,
  emphasis,
  lit,
  onToggle,
  onLit,
  style,
}: {
  note: GuidedNote;
  commit: GuidedCommit;
  emphasis: number | null;
  lit: boolean;
  onToggle: (key: string) => void;
  onLit: (key: string | null) => void;
  style?: React.CSSProperties;
}) {
  const idea = commit.ideas[note.idea];
  if (idea === undefined) return null;
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: lighting the lines is a pointer nicety; the note reads the same without it
    <div
      className={`guided-note idea--${idea.colour} ${lit ? "guided-note--lit" : ""} ${emphasis !== null && emphasis !== note.idea ? "guided-note--off" : ""}`}
      data-note={note.key}
      style={style}
      onMouseEnter={() => onLit(note.key)}
      onMouseLeave={() => onLit(null)}
    >
      <NoteHead note={note} commit={commit}>
        <span className="guided-note__grow" />
        <button
          type="button"
          className="guided-note__hide"
          onClick={() => onToggle(note.key)}
        >
          hide
        </button>
      </NoteHead>
      <p className="guided-note__text">{note.note}</p>
    </div>
  );
}

/** A note peeked at from its tab, floating under it. */
export function NotePeek({
  peeked,
  commit,
}: {
  peeked: Peeked;
  commit: GuidedCommit;
}) {
  const { note, box } = peeked;
  const idea = commit.ideas[note.idea];
  if (idea === undefined) return null;
  const below = box.bottom + 6;
  return (
    <div
      className={`guided-peek idea--${idea.colour}`}
      role="tooltip"
      style={{
        left: Math.max(
          8,
          Math.min(box.left, window.innerWidth - PEEK_WIDTH - 8),
        ),
        ...(below + 160 < window.innerHeight
          ? { top: below }
          : { bottom: window.innerHeight - box.top + 6 }),
        width: Math.min(PEEK_WIDTH, window.innerWidth - 16),
      }}
    >
      <NoteHead note={note} commit={commit}>
        <span className="guided-faint">· click to keep open</span>
      </NoteHead>
      <p className="guided-note__text">{note.note}</p>
    </div>
  );
}
// ~/~ end
