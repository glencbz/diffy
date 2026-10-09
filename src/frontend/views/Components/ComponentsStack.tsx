// ~/~ begin <<docs/architecture/frontend/components.md#frontend-view-components-stack>>[init]
import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { AsyncState } from "../../model/asyncState";
import {
  type Component,
  counterpartFate,
  type DrawnPlace,
  drawnPlaces,
  type Fate,
  fileShares,
  interdiffFate,
  marked,
  mentionedIn,
  type NamedVersion,
  type PlaceRef,
  placeAt,
  placeKey,
  type RowCounterpart,
  type RowTrees,
  rowTrees,
  runStarts,
  sameRun,
} from "../../model/components";
import type { FileDiff } from "../../model/diff";
import type { Comment } from "../../model/review";
import type { StackLayer, StackRow } from "../CommitStack";
import type { LineDecor } from "../DiffView/FileRow/FileRow";
import { paneSize, Splitter } from "../Splitter";
import { Heading, type HeadingParts, type Switch } from "./Heading";
import { Peek, type Peeked } from "./Peek";
import { Rail, type RailEntry } from "./Rail";
import { Trail } from "./Trail";

type CodeLine = Parameters<LineDecor["lineClass"]>[0];

export interface ComponentsStackProps {
  rows: StackRow[];
  /** Every component of the versions the screen compares, and of the
   *  version the rows are held against. */
  components: Component[];
  /** The row the address names, which the rail describes. */
  current: string | null;
  open: ReadonlySet<string>;
  onOpenRow: (key: string) => void;
  /** The comparison on screen; a null `from` is the base. */
  from: NamedVersion | null;
  to: NamedVersion;
  /** The version a commit's own diff is held against, and the comparison
   *  of the two, if it has one. */
  counterpartOf: (commitId: string) => RowCounterpart | null;
  /** Each commit's own diff, once asked for. */
  ownDiffs: ReadonlyMap<string, AsyncState<FileDiff[]>>;
  onWantOwn: (commitId: string) => void;
  onCompare: (from: string | null, to: string) => void;
  /** Every comment in the review document. */
  comments: Comment[];
  split: boolean;
  /** The rail's width as the reader dragged it, or null for the default. */
  railSize: number | null;
  onRailResize: (size: number | null) => void;
  children: (layer: StackLayer) => ReactNode;
}

/** Where the reader asked to land: a heading, held at a height on screen. */
interface Landing {
  key: string | null;
  id: string;
  path: string | null;
  /** Pixels from the top of the window, or null for the reading line. */
  y: number | null;
  /** A part of a commit message to land on instead of a heading. */
  selector: string | null;
  at: number;
  opened: boolean;
  /** Once landed, until when to keep it there while the page settles. */
  settle: number | null;
  /** The comparison it lands in, so a switch does not land on the page it
   *  is leaving. */
  on: string;
}

/** A place the reader can go back to. */
interface Step {
  label: string;
  from: string | null;
  to: string;
  landing: Omit<Landing, "at" | "opened" | "y" | "settle" | "on">;
  /** The row whose message the step was, to open it again. */
  message: string | null;
}

/** A place stays found this long while its comparison loads. */
const PATIENCE = 8000;
/** And is held where it landed this long while the page around it loads. */
const SETTLE = 1200;

const comparisonKey = (from: string | null, to: string) =>
  `${from ?? "base"}>${to}`;

export function ComponentsStack({
  rows,
  components,
  current,
  open,
  onOpenRow,
  from,
  to,
  counterpartOf,
  ownDiffs,
  onWantOwn,
  onCompare,
  comments,
  split,
  railSize,
  onRailResize,
  children,
}: ComponentsStackProps) {
  const here = comparisonKey(from?.id ?? null, to.id);
  const body = useRef<HTMLDivElement>(null);
  const [landing, setLanding] = useState<Landing | null>(null);
  const [trail, setTrail] = useState<Step[]>([]);
  const [peeked, setPeeked] = useState<Peeked | null>(null);
  const [reading, setReading] = useState<{
    id: string;
    path: string;
  } | null>(null);
  const [messages, setMessages] = useState<ReadonlySet<string>>(new Set());

  const placesOf = useMemo(() => {
    const out = new Map<string, DrawnPlace[]>();
    for (const row of rows) {
      if (row.files.status !== "ready" || row.kind === "dropped") continue;
      out.set(row.key, drawnPlaces(components, rowTrees(row), row.files.data));
    }
    return out;
  }, [rows, components]);
  const commitsOf = (commitId: string) =>
    components.filter((each) => each.commitId === commitId);

  const versionOf = (commitId: string) => {
    for (const row of rows) {
      if (row.commit.commitId === commitId) return to.name;
      if (row.was?.commitId === commitId) return from?.name ?? "";
      const counterpart = counterpartOf(row.commit.commitId);
      if (counterpart?.commitId === commitId) return counterpart.version.name;
    }
    return commitId.slice(0, 7);
  };

  // A line comment counts lines of its commit's own tree on the after side
  // and of the commit's parent on the before side, as a place does.
  const commentsOn = (id: string) =>
    comments.filter(
      (comment) =>
        comment.kind === "line" &&
        placeAt(
          components,
          { commitId: comment.commitId, side: comment.side },
          comment.path,
          comment.line,
        )?.component.id === id,
    );

  // Whatever scrolls the stack: the diff pane on a wide screen, the panes'
  // drawer on a phone.
  const scroller = () => {
    for (
      let at = body.current?.parentElement ?? null;
      at !== null;
      at = at.parentElement
    ) {
      const overflow = getComputedStyle(at).overflowY;
      if (
        (overflow === "auto" || overflow === "scroll") &&
        at.scrollHeight > at.clientHeight + 1
      ) {
        return at;
      }
    }
    return null;
  };
  const readingLine = () => {
    const pane = scroller();
    return pane === null
      ? innerHeight * 0.3
      : pane.getBoundingClientRect().top + pane.clientHeight * 0.3;
  };
  const headings = () => [
    ...(body.current?.querySelectorAll<HTMLElement>("[data-components-key]") ??
      []),
  ];
  const find = (target: Landing): HTMLElement | null => {
    if (target.selector !== null) {
      return body.current?.querySelector<HTMLElement>(target.selector) ?? null;
    }
    const all = headings();
    const onPath = (each: HTMLElement) =>
      target.path === null || each.dataset.path === target.path;
    return (
      all.find(
        (each) => each.dataset.componentsKey === target.key && onPath(each),
      ) ??
      all.find((each) => each.dataset.componentsKey === target.key) ??
      all.find(
        (each) => each.dataset.componentsId === target.id && onPath(each),
      ) ??
      all.find((each) => each.dataset.componentsId === target.id) ??
      null
    );
  };

  // A new comparison loads its rows and diffs after the ask, so landing
  // tries after every render until the heading is drawn, opening the row
  // that holds it on the way.
  useLayoutEffect(() => {
    if (landing === null || landing.on !== here) return;
    const element = find(landing);
    if (element === null) {
      if (Date.now() - landing.at > PATIENCE) {
        setLanding(null);
        return;
      }
      const row = rows.find((each) =>
        placesOf
          .get(each.key)
          ?.some(
            (drawn) =>
              placeKey(drawn.ref) === landing.key ||
              drawn.ref.component.id === landing.id,
          ),
      );
      if (row !== undefined && !open.has(row.key) && !landing.opened) {
        onOpenRow(row.key);
        setLanding({ ...landing, opened: true });
      }
      return;
    }
    // Highlighting and the rows above still load after the heading is drawn,
    // so the heading is held where it was asked for until they settle.
    const want = landing.y ?? readingLine() - 24;
    const by = element.getBoundingClientRect().top - want;
    const pane = scroller();
    if (pane !== null) pane.scrollTop += by;
    else window.scrollBy(0, by);
    if (landing.settle === null) {
      flash(element);
      setLanding({ ...landing, settle: Date.now() + SETTLE });
    } else if (Date.now() > landing.settle) {
      setLanding(null);
    }
  });
  // A heading waiting on a diff that has not landed yet needs a nudge to
  // look again.
  useEffect(() => {
    if (landing === null) return;
    const timer = setInterval(
      () => setLanding((now) => (now === null ? null : { ...now })),
      150,
    );
    return () => clearInterval(timer);
  }, [landing]);

  // The heading last passed by the reading line is the place being read.
  // biome-ignore lint/correctness/useExhaustiveDependencies: listens once, reading the page as it is
  useEffect(() => {
    const panes = body.current?.closest(".panes");
    let frame = 0;
    const read = () => {
      frame = 0;
      const line = readingLine();
      let found: { id: string; path: string } | null = null;
      for (const heading of headings()) {
        if (heading.getBoundingClientRect().top > line) break;
        found = {
          id: heading.dataset.componentsId ?? "",
          path: heading.dataset.path ?? "",
        };
      }
      setReading((now) =>
        now?.id === found?.id && now?.path === found?.path ? now : found,
      );
    };
    const onScroll = () => {
      if (frame === 0) frame = requestAnimationFrame(read);
      setPeeked((now) => (now?.kind === "lines" ? null : now));
    };
    // Captured, so a scroll of whichever pane holds the stack is heard.
    panes?.addEventListener("scroll", onScroll, {
      passive: true,
      capture: true,
    });
    window.addEventListener("scroll", onScroll, { passive: true });
    read();
    return () => {
      panes?.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);

  const goTo = (
    target: Omit<Landing, "at" | "opened" | "y" | "settle" | "on">,
    y: number | null = null,
    on: string = here,
  ) => {
    setPeeked(null);
    setLanding({
      ...target,
      y,
      at: Date.now(),
      opened: false,
      settle: null,
      on,
    });
  };
  const toPlace = (ref: PlaceRef, path: string | null) => ({
    key: placeKey(ref),
    id: ref.component.id,
    path,
    selector: null,
  });
  const tag = () =>
    from === null ? ` (${to.name})` : ` (${from.name}→${to.name})`;
  const remember = (ref: PlaceRef, path: string) =>
    setTrail((now) => [
      ...now,
      {
        label: `${ref.component.name}${tag()}`,
        from: from?.id ?? null,
        to: to.id,
        landing: toPlace(ref, path),
        message: null,
      },
    ]);
  const rememberMessage = (row: string, id: string | null) =>
    setTrail((now) => [
      ...now,
      {
        label: "commit message",
        from: from?.id ?? null,
        to: to.id,
        landing: messageTarget(row, id),
        message: row,
      },
    ]);
  const messageTarget = (row: string, id: string | null) => ({
    key: null,
    id: id ?? "",
    path: null,
    selector:
      id === null
        ? `[data-components-message="${row}"]`
        : `[data-components-message="${row}"][data-components-mention="${id}"]`,
  });
  /** Shows a commit's message whole, at the phrase describing `id`. */
  const showMessage = (row: string, id: string | null) => {
    setMessages((now) => (now.has(row) ? now : new Set(now).add(row)));
    goTo(messageTarget(row, id));
  };
  /** Opens another comparison with the same place at the same height. */
  const compareAt = (
    nextFrom: string | null,
    nextTo: string,
    ref: PlaceRef,
    path: string,
    heading: HTMLElement | null,
  ) => {
    remember(ref, path);
    onCompare(nextFrom, nextTo);
    goTo(
      toPlace(ref, path),
      heading?.getBoundingClientRect().top ?? null,
      comparisonKey(nextFrom, nextTo),
    );
  };
  const back = (index: number) => {
    const step = trail[index];
    if (step === undefined) return;
    setTrail(trail.slice(0, index));
    if (step.from !== (from?.id ?? null) || step.to !== to.id) {
      onCompare(step.from, step.to);
    }
    if (step.message !== null) {
      const row = step.message;
      setMessages((now) => (now.has(row) ? now : new Set(now).add(row)));
    }
    goTo(step.landing, null, comparisonKey(step.from, step.to));
  };

  let leaving = 0;
  const leave = () => {
    window.clearTimeout(leaving);
    leaving = window.setTimeout(() => {
      if (document.querySelector(".components-peek:hover") === null) {
        setPeeked((now) => (now?.kind === "lines" ? null : now));
      }
    }, 250);
  };
  const peekLines = (
    target: HTMLElement,
    title: string,
    note: string,
    component: Component,
    files: AsyncState<FileDiff[]>,
    trees: RowTrees,
    path: string,
  ) => {
    const box = target.getBoundingClientRect();
    setPeeked({
      kind: "lines",
      title,
      note,
      component,
      files,
      trees,
      path,
      x: box.left,
      y: box.bottom + 6,
    });
  };
  // A peek at a diff still loading shows what has landed since.
  const shownPeek: Peeked | null =
    peeked?.kind === "lines" && peeked.files.status === "loading"
      ? {
          ...peeked,
          files:
            ownDiffs.get(peeked.trees.after.commitId) ??
            counterpartOf(peeked.trees.after.commitId)?.files ??
            peeked.files,
        }
      : peeked;

  /** The place a drawn line belongs to, in the trees its row draws. */
  const placeOfLine = (
    trees: RowTrees,
    file: FileDiff,
    line: CodeLine,
  ): PlaceRef | null => {
    const before = line.anchor.side === "before";
    const path =
      "path" in file ? file.path : before ? file.oldPath : file.newPath;
    return placeAt(
      components,
      before ? trees.before : trees.after,
      path,
      line.anchor.line,
    );
  };

  const fateOf = (row: StackRow, drawn: DrawnPlace): Fate | null => {
    if (row.was !== null) {
      return interdiffFate(
        drawn.ref,
        commitsOf(row.was.commitId),
        commitsOf(row.commit.commitId),
      );
    }
    const counterpart = counterpartOf(row.commit.commitId);
    if (counterpart === null || counterpart.files.status !== "ready") {
      return null;
    }
    return counterpartFate(drawn.ref, drawn.path, {
      ...counterpart,
      files: counterpart.files.data,
    });
  };

  const headingParts = (
    row: StackRow,
    drawn: DrawnPlace,
    side: "before" | "after",
  ): HeadingParts => {
    const { ref, path } = drawn;
    const { component } = ref;
    const places = runStarts(placesOf.get(row.key) ?? []).filter(
      (each) => each.ref.component.id === component.id,
    );
    const index = places.findIndex(
      (each) => placeKey(each.ref) === placeKey(ref) && each.path === path,
    );
    // Side by side, a place with nothing added has no after column to carry
    // the rest, so its before column does.
    const rest = !split || side === "after" || drawn.added === 0;
    const own = !split || side === "before" || drawn.removed === 0;
    const fate = fateOf(row, drawn);
    const sides: Switch[] = [];
    let counterpart: Switch | null = null;
    let words: HeadingParts["fate"] = null;
    if (row.was !== null && from !== null) {
      const was = row.was;
      const side = (version: NamedVersion, commitId: string): Switch => ({
        label: version.name,
        title: `open ${version.name}'s own diff here, at this height`,
        onPeek: (target) => {
          onWantOwn(commitId);
          peekLines(
            target,
            `${component.name} as ${version.name} makes it`,
            "",
            component,
            ownDiffs.get(commitId) ?? { status: "loading" },
            rowTrees({ commit: { commitId }, was: null }),
            path,
          );
        },
        // A run that joins both versions' lines lands on the version's own.
        onGo: (heading) =>
          compareAt(
            null,
            version.id,
            (placesOf.get(row.key) ?? []).find(
              (each) =>
                each.path === path &&
                each.ref.component.commitId === commitId &&
                sameRun(each.ref, ref),
            )?.ref ?? ref,
            path,
            heading,
          ),
      });
      if (fate === "new" && rest) {
        words = { fate, text: `new in ${to.name}` };
      }
      if (fate === "removed" && own) {
        words = { fate, text: `removed in ${to.name}` };
      }
      if (own && fate !== "new") sides.push(side(from, was.commitId));
      if (rest && fate !== "removed") {
        sides.push(side(to, row.commit.commitId));
      }
    } else if (rest && fate !== null && fate !== "unchanged") {
      const other = counterpartOf(row.commit.commitId);
      if (other !== null && fate === "changed") {
        const since = other.direction === "since";
        const [older, newer] = since
          ? [other.commitId, row.commit.commitId]
          : [row.commit.commitId, other.commitId];
        counterpart = {
          label: since
            ? `changed since ${other.version.name}`
            : `changes in ${other.version.name}`,
          title: "open the comparison of the two versions here",
          onPeek: (target) =>
            peekLines(
              target,
              `${component.name} between ${since ? other.version.name : to.name} and ${since ? to.name : other.version.name}`,
              "",
              component,
              other.files,
              {
                before: { commitId: older, side: "after" },
                after: { commitId: newer, side: "after" },
              },
              path,
            ),
          onGo: (heading) =>
            since
              ? compareAt(other.version.id, to.id, ref, path, heading)
              : compareAt(to.id, other.version.id, ref, path, heading),
        };
      } else if (other !== null) {
        words = {
          fate,
          text:
            fate === "new"
              ? `new in ${to.name}`
              : `removed in ${other.version.name}`,
        };
      }
    }
    const moved = component.places[ref.place]?.moves;
    const target = moved === undefined ? undefined : component.places[moved];
    const leaves = component.places[ref.place]?.side === "before";
    return {
      at: ref,
      path,
      fate: words,
      sides,
      counterpart,
      move:
        !rest || moved === undefined || target === undefined
          ? null
          : {
              text: `moved ${leaves ? "to" : "from"} ${target.about || target.path}`,
              title: `where this code moved ${leaves ? "to" : "from"}`,
              onGo: () => {
                remember(ref, path);
                goTo(toPlace({ component, place: moved }, target.path));
              },
            },
      message:
        rest && index === 0 && mentionedIn(row.commit.description, component)
          ? () => {
              remember(ref, path);
              showMessage(row.key, component.id);
            }
          : null,
      threads:
        rest && index === 0 && commentsOn(component.id).length > 0
          ? {
              count: commentsOn(component.id).length,
              onOpen: (target) => {
                const box = target.getBoundingClientRect();
                setPeeked({
                  kind: "threads",
                  component,
                  comments: commentsOn(component.id),
                  versionOf,
                  x: box.left,
                  y: box.bottom + 6,
                });
              },
            }
          : null,
      places:
        rest && places.length > 1
          ? {
              index,
              count: places.length,
              onStep: (by) => {
                const next =
                  places[(index + by + places.length) % places.length];
                if (next !== undefined) goTo(toPlace(next.ref, next.path));
              },
            }
          : null,
      onLeave: leave,
    };
  };

  // Names in the code, and phrases in a message, that link to components.
  const words = useMemo(
    () =>
      new Map(
        components.flatMap((each) =>
          each.words.map((word) => [word, each] as const),
        ),
      ),
    [components],
  );
  const phrases = useMemo(
    () =>
      new Map(
        components.flatMap((each) =>
          each.mentions.map((phrase) => [phrase, each] as const),
        ),
      ),
    [components],
  );
  const firstPlace = (id: string) => {
    for (const row of rows) {
      const drawn = placesOf
        .get(row.key)
        ?.find((each) => each.ref.component.id === id);
      if (drawn !== undefined) return { row, drawn };
    }
    return null;
  };
  const peekFirst = (target: HTMLElement, component: Component) => {
    const found = firstPlace(component.id);
    if (found === null) return;
    peekLines(
      target,
      `${component.kind} ${component.name}`,
      component.gist,
      component,
      found.row.files,
      rowTrees(found.row),
      found.drawn.path,
    );
  };
  const wordsIn = (
    text: string,
    line: CodeLine,
    trees: RowTrees,
    file: FileDiff,
  ) => {
    const runs = marked(text, words, true);
    if (runs.every((run) => run.mark === null)) return text;
    return runs.map((run, index) => {
      const component = run.mark;
      if (component === null) return run.text;
      return (
        <button
          type="button"
          // biome-ignore lint/suspicious/noArrayIndexKey: runs of one token's text
          key={index}
          className={`components-word components-kind--${component.kind}`}
          onMouseEnter={(event) => peekFirst(event.currentTarget, component)}
          onMouseLeave={leave}
          onClick={(event) => {
            // A click on a line opens the composer; a word is a link.
            event.stopPropagation();
            const here = placeOfLine(trees, file, line);
            if (here !== null) {
              remember(here, "path" in file ? file.path : file.newPath);
            }
            const found = firstPlace(component.id);
            if (found !== null)
              goTo(toPlace(found.drawn.ref, found.drawn.path));
          }}
        >
          {run.text}
        </button>
      );
    });
  };
  const mentionsIn = (row: StackRow, text: string) => {
    const runs = marked(text, phrases, false);
    if (runs.every((run) => run.mark === null)) return text;
    return runs.map((run, index) => {
      const component = run.mark;
      if (component === null) return run.text;
      const found = firstPlace(component.id);
      return (
        <button
          type="button"
          // biome-ignore lint/suspicious/noArrayIndexKey: runs of one paragraph's text
          key={index}
          className={`components-mention components-kind--${component.kind}${found === null ? " components-mention--absent" : ""}`}
          data-components-message={row.key}
          data-components-mention={component.id}
          title={`${component.kind} ${component.name}${found === null ? ": nothing of it in this comparison" : ""}`}
          onMouseEnter={(event) => peekFirst(event.currentTarget, component)}
          onMouseLeave={leave}
          onClick={() => {
            if (found === null) return;
            rememberMessage(row.key, component.id);
            goTo(toPlace(found.drawn.ref, found.drawn.path));
          }}
        >
          {run.text}
        </button>
      );
    });
  };

  const layer: StackLayer = {
    message: () => null,
    messageOpen: (row) => messages.has(row.key),
    messageWords: (row) => (text) => mentionsIn(row, text),
    decor: (row) => {
      const places = placesOf.get(row.key);
      if (places === undefined || places.length === 0) return undefined;
      const trees = rowTrees(row);
      return (file) => {
        const path = "path" in file ? file.path : file.newPath;
        return {
          header: null,
          lineClass: (line) => {
            if (line.kind === "context") return null;
            const ref = placeOfLine(trees, file, line);
            if (ref === null) return null;
            const lit =
              reading?.id === ref.component.id && reading.path === path;
            return `components-line components-kind--${ref.component.kind}${lit ? " components-line--reading" : ""}`;
          },
          marker: () => null,
          under: () => null,
          above: () => null,
          aside: null,
          over: (line, previous) => {
            if (line.kind === "context") return null;
            const ref = placeOfLine(trees, file, line);
            if (ref === null) return null;
            const was =
              previous === null ? null : placeOfLine(trees, file, previous);
            if (was !== null && sameRun(was, ref)) return null;
            const drawn = places.find(
              (each) =>
                placeKey(each.ref) === placeKey(ref) && each.path === path,
            );
            if (drawn === undefined) return null;
            return <Heading {...headingParts(row, drawn, line.anchor.side)} />;
          },
          token: (text, line) => wordsIn(text, line, trees, file),
        };
      };
    },
  };

  // ---- the rail: the current row's components and files ----
  const shown =
    rows.find((each) => each.key === current) ??
    rows.find((each) => (placesOf.get(each.key)?.length ?? 0) > 0);
  const drawnHere = shown === undefined ? [] : (placesOf.get(shown.key) ?? []);
  const entries: RailEntry[] = [];
  if (shown !== undefined) {
    const listed = [
      ...commitsOf(shown.commit.commitId),
      ...(shown.was === null ? [] : commitsOf(shown.was.commitId)),
      ...(shown.was === null
        ? (counterpartOf(shown.commit.commitId)?.components ?? [])
        : []),
    ];
    const seen = new Set<string>();
    for (const component of listed) {
      if (seen.has(component.id)) continue;
      seen.add(component.id);
      const mine = drawnHere.filter(
        (each) => each.ref.component.id === component.id,
      );
      const fates = mine.map((each) => fateOf(shown, each));
      const runs = runStarts(drawnHere).filter(
        (each) => each.ref.component.id === component.id,
      );
      const inCommit = component.commitId === shown.commit.commitId;
      const fate: Fate | null =
        mine.length === 0
          ? shown.was !== null
            ? "unchanged"
            : inCommit
              ? null
              : "removed"
          : fates.includes("new")
            ? "new"
            : fates.includes("removed")
              ? "removed"
              : fates.includes("changed")
                ? "changed"
                : null;
      entries.push({
        component,
        fate,
        drawn: mine.length > 0,
        places: runs.length,
        threads: commentsOn(component.id).length,
      });
    }
  }
  const files =
    shown?.files.status === "ready"
      ? shown.files.data.map((file) => ({
          path: "path" in file ? file.path : file.newPath,
          shares: fileShares(components, rowTrees(shown), file),
        }))
      : [];

  return (
    <>
      <div className="components-body" ref={body}>
        <aside
          className={`components-rail${railSize === null ? "" : " pane--sized"}`}
          style={paneSize(railSize)}
        >
          <Rail
            comparing={
              from === null
                ? `in ${to.name}`
                : `between ${from.name} and ${to.name}`
            }
            entries={entries}
            files={files}
            reading={reading}
            onMessage={
              shown !== undefined &&
              components.some(
                (each) =>
                  each.commitId === shown.commit.commitId &&
                  mentionedIn(shown.commit.description, each),
              )
                ? () => showMessage(shown.key, null)
                : null
            }
            onGo={(entry) => {
              const drawn = drawnHere.find(
                (each) => each.ref.component.id === entry.component.id,
              );
              if (drawn !== undefined) {
                goTo(toPlace(drawn.ref, drawn.path));
              } else if (from !== null) {
                // Unchanged between versions: read it in the newer one.
                onCompare(null, to.id);
                goTo(
                  {
                    key: null,
                    id: entry.component.id,
                    path: null,
                    selector: null,
                  },
                  null,
                  comparisonKey(null, to.id),
                );
              }
            }}
            onGoShare={(path, share) => {
              if (share.first !== null) goTo(toPlace(share.first, path));
            }}
          />
        </aside>
        <Splitter
          pane="components-rail"
          size={railSize}
          onResize={onRailResize}
          label="resize the components rail"
        />
        <div className="components-main">{children(layer)}</div>
      </div>
      <Trail
        labels={trail.map((step) => step.label)}
        onBack={back}
        onForget={() => setTrail([])}
      />
      {shownPeek !== null && (
        <Peek
          peeked={shownPeek}
          components={components}
          onLeave={() =>
            setPeeked((now) => (now?.kind === "lines" ? null : now))
          }
          onClose={() => setPeeked(null)}
        />
      )}
    </>
  );
}

function flash(element: HTMLElement) {
  element.classList.remove("components-flash");
  void element.offsetWidth;
  element.classList.add("components-flash");
}
// ~/~ end
