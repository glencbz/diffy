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
import { fileAnchor } from "../../model/changedFiles";
import {
  type Component,
  type Counterparts,
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
  /** Off, the stack draws as it would without a map, still inside this
   *  view, so switching the map on or off keeps every file's state. */
  enabled: boolean;
  rows: StackRow[];
  /** Every component of the versions the screen compares, and of the
   *  version the rows are held against. */
  components: Component[];
  /** The row the address names, which the rail describes. */
  current: string | null;
  open: ReadonlySet<string>;
  onOpenRow: (key: string) => void;
  /** Shows a row's whole message, as the reader can by unfolding it. */
  onExpandMessage: (key: string) => void;
  /** The comparison on screen; a null `from` is the base. */
  from: NamedVersion | null;
  to: NamedVersion;
  /** The version a commit's own diff is held against, and each commit's
   *  counterpart there. */
  counterparts: Counterparts;
  /** Each commit's own diff, once asked for. */
  ownDiffs: ReadonlyMap<string, AsyncState<FileDiff[]>>;
  onWantOwn: (commitId: string) => void;
  /** Opens another comparison, at `commit` when one is named. */
  onCompare: (from: string | null, to: string, commit: string | null) => void;
  /** Every comment in the review document. */
  comments: Comment[];
  split: boolean;
  /** The rail's width as the reader dragged it, or null for the default. */
  railSize: number | null;
  onRailResize: (size: number | null) => void;
  children: (layer: StackLayer | undefined) => ReactNode;
}

/** What to land on: a heading by its place or component, or anything else
 *  by a selector. */
interface Target {
  key: string | null;
  id: string;
  path: string | null;
  selector: string | null;
}

/** Where the reader asked to land, held at a height on screen. */
interface Landing extends Target {
  /** Pixels from the top of the window, or null for the reading line. */
  y: number | null;
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
  /** The commit the address named there. */
  commit: string | null;
  target: Target;
  /** The row whose message the step was, to show it whole again. */
  message: string | null;
  /** Where on screen the place was, to land it there again. */
  y: number | null;
}

/** A place stays looked for this long while its comparison loads. */
const PATIENCE = 8000;
/** And is held where it landed this long while the page around it loads,
 *  unless the reader scrolls first. */
const SETTLE = 1200;

const comparisonKey = (from: string | null, to: string) =>
  `${from ?? "base"}>${to}`;

/** A component id as part of a class name. */
const ident = (id: string) => id.replace(/[^\w-]/g, "_");

export function ComponentsStack(props: ComponentsStackProps) {
  const {
    enabled,
    rows,
    components,
    current,
    open,
    onOpenRow,
    from,
    to,
    counterparts,
    comments,
    split,
    railSize,
    onRailResize,
    children,
  } = props;
  const here = comparisonKey(from?.id ?? null, to.id);
  const counterpartOf = counterparts.of;
  const body = useRef<HTMLDivElement>(null);
  const leaving = useRef(0);
  const [landing, setLanding] = useState<Landing | null>(null);
  const [trail, setTrail] = useState<Step[]>([]);
  // The browser's own Back leaves the trail's steps pointing at a page the
  // reader has already gone back past, so it forgets them.
  useEffect(() => {
    const forget = () => setTrail([]);
    window.addEventListener("popstate", forget);
    return () => window.removeEventListener("popstate", forget);
  }, []);
  const [peeked, setPeeked] = useState<Peeked | null>(null);
  const [reading, setReading] = useState<{
    id: string;
    path: string;
  } | null>(null);

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

  /** Where a thread's line is drawn in this comparison, if it is. A
   *  comparison of two commits keeps the older one's lines on its left,
   *  counted as that commit's own tree. */
  const threadAt = (comment: Comment): string | null => {
    if (comment.kind !== "line") return null;
    for (const row of rows) {
      const side =
        comment.commitId === row.commit.commitId
          ? row.was === null
            ? comment.side
            : comment.side === "after"
              ? "after"
              : null
          : comment.commitId === row.was?.commitId && comment.side === "after"
            ? "before"
            : null;
      if (side !== null) {
        return `.diff-file[data-path="${CSS.escape(comment.path)}"] [data-anchor="${side}:${comment.line}"]`;
      }
    }
    return null;
  };

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
  const find = (target: Target): HTMLElement | null => {
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
  // tries after every render until the target is drawn, opening the row
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
      } else if (row !== undefined && open.has(row.key)) {
        // A folded file, or one marked viewed, holds it: unfold it the way
        // the reader would, so folding it again works as it always does.
        const paths = (placesOf.get(row.key) ?? [])
          .filter(
            (drawn) =>
              placeKey(drawn.ref) === landing.key ||
              drawn.ref.component.id === landing.id,
          )
          .map((drawn) => drawn.path);
        for (const path of landing.path === null ? paths : [landing.path]) {
          const toggle = document
            .getElementById(fileAnchor(row.commit.commitId, path))
            ?.querySelector<HTMLElement>(
              '.diff-file__toggle[aria-expanded="false"]',
            );
          if (toggle != null) {
            toggle.click();
            // The file draws itself; this view tries again once it has.
            setLanding({ ...landing });
            break;
          }
        }
      }
      return;
    }
    // Highlighting and the rows above still load after the target is drawn,
    // so it is held where it was asked for until they settle.
    const want = landing.y ?? readingLine() - 24;
    const by = element.getBoundingClientRect().top - want;
    const pane = scroller();
    if (pane !== null) pane.scrollTop += by;
    else window.scrollBy(0, by);
    if (landing.settle === null) {
      flash(element);
      // A switch that keeps the heading's height can leave it below the
      // reading line, and the rail should still name it.
      const id = element.dataset.componentsId;
      if (id !== undefined)
        setReading({ id, path: element.dataset.path ?? "" });
      setLanding({ ...landing, settle: Date.now() + SETTLE });
    } else if (Date.now() > landing.settle) {
      setLanding(null);
    }
  });
  const landingNow = landing !== null;
  useEffect(() => () => window.clearTimeout(leaving.current), []);
  useEffect(() => {
    if (!landingNow) return;
    // A target still loading needs a nudge to look again.
    const timer = setInterval(
      () => setLanding((now) => (now === null ? null : { ...now })),
      150,
    );
    // The reader scrolling is the reader taking over.
    const stop = () => setLanding(null);
    const options = { passive: true, capture: true } as const;
    window.addEventListener("wheel", stop, options);
    window.addEventListener("touchstart", stop, options);
    window.addEventListener("keydown", stop, options);
    window.addEventListener("pointerdown", stop, options);
    return () => {
      window.removeEventListener("pointerdown", stop, options);
      clearInterval(timer);
      window.removeEventListener("wheel", stop, options);
      window.removeEventListener("touchstart", stop, options);
      window.removeEventListener("keydown", stop, options);
    };
  }, [landingNow]);

  // The heading last passed by the reading line is the place being read. A
  // peek belongs to where it was opened, so a scroll closes it.
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
    const onScroll = (event: Event) => {
      // A peek too long or wide for its box scrolls itself, and stays.
      if (
        event.target instanceof Element &&
        event.target.closest(".components-peek") !== null
      ) {
        return;
      }
      if (frame === 0) frame = requestAnimationFrame(read);
      setPeeked(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPeeked(null);
    };
    const onDown = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) return;
      if (event.target.closest(".components-peek") === null) setPeeked(null);
    };
    // Captured, so a scroll of whichever pane holds the stack is heard.
    panes?.addEventListener("scroll", onScroll, {
      passive: true,
      capture: true,
    });
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    read();
    return () => {
      panes?.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
      cancelAnimationFrame(frame);
    };
  }, []);

  const [railOpen, setRailOpen] = useState(false);
  const goTo = (target: Target, y: number | null = null, on = here) => {
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
  const toPlace = (ref: PlaceRef, path: string | null): Target => ({
    key: placeKey(ref),
    id: ref.component.id,
    path,
    selector: null,
  });
  const tag = () =>
    from === null ? ` (${to.name})` : ` (${from.name}→${to.name})`;
  const step = (
    label: string,
    target: Target,
    commit: string | null,
    message: string | null = null,
  ) => {
    const y = find(target)?.getBoundingClientRect().top ?? null;
    const at = from?.id ?? null;
    setTrail((now) => {
      // A second jump from the same place needs no second way back to it.
      const last = now.at(-1);
      if (last?.label === label && last.from === at && last.to === to.id) {
        return now;
      }
      return [
        ...now,
        { label, from: at, to: to.id, commit, target, message, y },
      ];
    });
  };
  /** The commit the address names while `ref` is on screen: the row's. */
  const rowCommitOf = (ref: PlaceRef) =>
    rows.find(
      (row) =>
        row.commit.commitId === ref.component.commitId ||
        row.was?.commitId === ref.component.commitId,
    )?.commit.commitId ?? ref.component.commitId;
  const remember = (ref: PlaceRef, path: string) =>
    step(`${ref.component.name}${tag()}`, toPlace(ref, path), rowCommitOf(ref));
  /** Remembers the place being read, for a jump that starts from no place. */
  const rememberHere = () => {
    const component = components.find((each) => each.id === reading?.id);
    step(
      component === undefined ? `top${tag()}` : `${component.name}${tag()}`,
      reading === null || component === undefined
        ? { key: null, id: "", path: null, selector: ".components-main" }
        : { key: null, id: reading.id, path: reading.path, selector: null },
      rows.find((row) => row.key === current)?.commit.commitId ?? null,
    );
  };
  const messageTarget = (row: string, id: string | null): Target => ({
    key: null,
    id: id ?? "",
    path: null,
    selector:
      id === null
        ? `.commit-stack__message:has([data-components-message="${CSS.escape(row)}"])`
        : `[data-components-message="${CSS.escape(row)}"][data-components-mention="${CSS.escape(id)}"]`,
  });
  const rememberMessage = (row: StackRow, id: string | null) =>
    step(
      "commit message",
      messageTarget(row.key, id),
      row.commit.commitId,
      row.key,
    );
  /** Shows a commit's message whole, at the phrase describing `id`. */
  const showMessage = (row: string, id: string | null) => {
    props.onExpandMessage(row);
    goTo(messageTarget(row, id));
  };
  /** Opens another comparison with the same place at the same height. */
  const compareAt = (
    nextFrom: string | null,
    nextTo: string,
    ref: PlaceRef,
    path: string,
    heading: HTMLElement | null,
    commit: string,
  ) => {
    remember(ref, path);
    props.onCompare(nextFrom, nextTo, commit);
    goTo(
      toPlace(ref, path),
      heading?.getBoundingClientRect().top ?? null,
      comparisonKey(nextFrom, nextTo),
    );
  };
  const back = (index: number) => {
    const target = trail[index];
    if (target === undefined) return;
    setTrail(trail.slice(0, index));
    if (target.from !== (from?.id ?? null) || target.to !== to.id) {
      props.onCompare(target.from, target.to, target.commit);
    }
    if (target.message !== null) props.onExpandMessage(target.message);
    goTo(target.target, target.y, comparisonKey(target.from, target.to));
  };

  const leave = () => {
    window.clearTimeout(leaving.current);
    leaving.current = window.setTimeout(() => {
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
    window.clearTimeout(leaving.current);
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
      above: box.top - 6,
    });
  };
  // A peek at a diff still loading shows what has landed since.
  const shownPeek: Peeked | null =
    peeked?.kind === "lines" && peeked.files.status === "loading"
      ? {
          ...peeked,
          files:
            props.ownDiffs.get(peeked.trees.after.commitId) ??
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
    if (counterpart === null) {
      if (counterparts.version === null) return null;
      return counterparts.direction === "since" ? "new" : "removed";
    }
    if (counterpart.files.status !== "ready") return null;
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
    // The message link and the threads go on the component's first heading.
    // Side by side, an interdiff draws each version's run in its own column,
    // so it is the first of this version's runs.
    const first =
      (placesOf.get(row.key) ?? []).find(
        (each) =>
          each.ref.component.id === component.id &&
          each.ref.component.commitId === component.commitId,
      ) === drawn;
    const fate = fateOf(row, drawn);
    // Side by side, each column's heading carries its own side, and the after
    // column's carries the rest. A run with no heading in the other column,
    // because nothing of it there is added or removed, carries it all.
    const drawsIn = (lines: "added" | "removed") =>
      (placesOf.get(row.key) ?? []).some(
        (each) =>
          each.path === path && sameRun(each.ref, ref) && each[lines] > 0,
      );
    const rest = !split || side === "after" || !drawsIn("added");
    const own = !split || side === "before" || !drawsIn("removed");
    const sides: Switch[] = [];
    let counterpart: Switch | null = null;
    let words: HeadingParts["fate"] = null;
    if (row.was !== null && from !== null) {
      const was = row.was;
      const side = (version: NamedVersion, commitId: string): Switch => ({
        label: version.name,
        title: `open ${version.name}'s own diff here, at this height`,
        onPeek: (target) => {
          props.onWantOwn(commitId);
          peekLines(
            target,
            `${component.name} as ${version.name} makes it`,
            "",
            component,
            props.ownDiffs.get(commitId) ?? { status: "loading" },
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
            commitId,
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
      const version = other?.version ?? counterparts.version;
      if (version !== null) {
        const since = counterparts.direction === "since";
        const [olderVersion, newerVersion] = since
          ? [version.id, to.id]
          : [to.id, version.id];
        // Each fate leads to the comparison that shows it: a change, a
        // component that arrived, or one the next version drops.
        counterpart = {
          label:
            fate === "changed"
              ? since
                ? `changed since ${version.name}`
                : `changes in ${version.name}`
              : fate === "new"
                ? `new in ${since ? to.name : version.name}`
                : `removed in ${version.name}`,
          fate,
          title: "open the comparison of the two versions here",
          onPeek: (target) => {
            if (other === null) return;
            const [older, newer] = since
              ? [other.commitId, row.commit.commitId]
              : [row.commit.commitId, other.commitId];
            peekLines(
              target,
              `${component.name} between ${since ? version.name : to.name} and ${since ? to.name : version.name}`,
              "",
              component,
              other.files,
              {
                before: { commitId: older, side: "after" },
                after: { commitId: newer, side: "after" },
              },
              path,
            );
          },
          // The interdiff's row is the newer version's commit, or the older
          // one's where the newer version has none.
          onGo: (heading) =>
            compareAt(
              olderVersion,
              newerVersion,
              ref,
              path,
              heading,
              since
                ? row.commit.commitId
                : (other?.commitId ?? row.commit.commitId),
            ),
        };
      }
    }
    // A place that moves code names the place at its other end. The end
    // that removes it is where the code moved from.
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
        rest && first && mentionedIn(row.commit.description, component)
          ? () => {
              remember(ref, path);
              showMessage(row.key, component.id);
            }
          : null,
      threads:
        rest && first && commentsOn(component.id).length > 0
          ? {
              count: commentsOn(component.id).length,
              onOpen: (target) => {
                const box = target.getBoundingClientRect();
                setPeeked({
                  kind: "threads",
                  component,
                  comments: commentsOn(component.id),
                  versionOf,
                  goTo: (comment) => {
                    const selector = threadAt(comment);
                    return selector === null
                      ? null
                      : () => {
                          remember(ref, path);
                          goTo({ key: null, id: "", path: null, selector });
                        };
                  },
                  x: box.left,
                  y: box.bottom + 6,
                  above: box.top - 6,
                });
              },
            }
          : null,
      places: rest
        ? {
            onStep: (by) => {
              const drawnHeadings = headings().filter(
                (each) =>
                  each.dataset.componentsId === component.id &&
                  each.querySelector(".components-heading__count") !== null &&
                  !each.hasAttribute("data-components-again"),
              );
              const at = drawnHeadings.findIndex(
                (each) =>
                  each.dataset.componentsKey === placeKey(ref) &&
                  each.dataset.path === path,
              );
              const next =
                drawnHeadings[
                  (at + by + drawnHeadings.length) % drawnHeadings.length
                ];
              if (next === undefined) return;
              goTo({
                key: next.dataset.componentsKey ?? null,
                id: component.id,
                path: next.dataset.path ?? null,
                selector: null,
              });
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
  /** Goes to a component's first drawn place or, on a comparison of two
   *  versions that leaves it out as unchanged, to it in the newer version.
   *  Null when neither draws it. */
  /** Opens a version compared with its counterpart, at a component only the
   *  counterpart has. */
  const toCounterpart = (row: StackRow, id: string) => {
    const other = counterpartOf(row.commit.commitId);
    if (other === null) return;
    const since = counterparts.direction === "since";
    const [older, newer] = since
      ? [other.version.id, to.id]
      : [to.id, other.version.id];
    props.onCompare(older, newer, since ? row.commit.commitId : other.commitId);
    goTo(
      { key: null, id, path: null, selector: null },
      null,
      comparisonKey(older, newer),
    );
  };
  const reach = (id: string): (() => void) | null => {
    const found = firstPlace(id);
    if (found !== null) {
      return () => goTo(toPlace(found.drawn.ref, found.drawn.path));
    }
    if (from === null) {
      // Only the counterpart version has it: the two compared draw it.
      const row = rows.find((each) =>
        counterpartOf(each.commit.commitId)?.components.some(
          (component) => component.id === id,
        ),
      );
      return row === undefined ? null : () => toCounterpart(row, id);
    }
    if (!components.some((each) => each.id === id)) return null;
    return () => {
      props.onCompare(null, to.id, null);
      goTo(
        { key: null, id, path: null, selector: null },
        null,
        comparisonKey(null, to.id),
      );
    };
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
  // Links are anchors rather than buttons, so they wrap with the text
  // around them.
  const link = (
    component: Component,
    text: string,
    key: number,
    className: string,
    onGo: () => void,
    data: Record<string, string | number> = {},
  ) => (
    <a
      key={key}
      href={`#components-${ident(component.id)}`}
      className={`${className} components-kind--${component.kind}`}
      {...data}
      onMouseEnter={(event) => peekFirst(event.currentTarget, component)}
      onMouseLeave={leave}
      onClick={(event) => {
        event.preventDefault();
        // A click on a line opens the composer; a link is not that.
        event.stopPropagation();
        onGo();
      }}
    >
      {text}
    </a>
  );
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
      const go = reach(component.id);
      if (go === null) return run.text;
      return link(
        component,
        run.text,
        index,
        "components-word",
        () => {
          const at = placeOfLine(trees, file, line);
          if (at !== null) {
            remember(at, "path" in file ? file.path : file.newPath);
          } else rememberHere();
          go();
        },
        // Names in code are many; tabbing goes through the diff's own
        // stops, and the rail reaches every component.
        { tabIndex: -1 },
      );
    });
  };
  const mentionsIn = (row: StackRow, text: string) => {
    const runs = marked(text, phrases, false);
    if (runs.every((run) => run.mark === null)) return text;
    return runs.map((run, index) => {
      const component = run.mark;
      if (component === null) return run.text;
      const go = reach(component.id);
      if (go === null) return run.text;
      return link(
        component,
        run.text,
        index,
        "components-mention",
        () => {
          rememberMessage(row, component.id);
          go();
        },
        {
          "data-components-message": row.key,
          "data-components-mention": component.id,
          title: `${component.kind} ${component.name}`,
        },
      );
    });
  };

  // The layer reads everything through `live`, so it only has to change
  // when what it draws does. A hover or the reading line moving draws this
  // view again, not the diff under it.
  const live = useRef({ headingParts, placeOfLine, wordsIn, mentionsIn });
  live.current = { headingParts, placeOfLine, wordsIn, mentionsIn };
  const fates = rows
    .map(
      (row) =>
        `${row.key}:${counterpartOf(row.commit.commitId)?.files.status ?? "-"}`,
    )
    .join(" ");
  // biome-ignore lint/correctness/useExhaustiveDependencies: what the layer draws from; the rest it reads through `live`
  const layer = useMemo(
    (): StackLayer => ({
      message: () => null,
      messageWords: (row) => (text) => live.current.mentionsIn(row, text),
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
              const ref = live.current.placeOfLine(trees, file, line);
              if (ref === null) return null;
              return `components-line components-kind--${ref.component.kind} components-of--${ident(ref.component.id)}`;
            },
            marker: () => null,
            under: () => null,
            above: () => null,
            aside: null,
            over: (line, earlier) => {
              if (line.kind === "context") return null;
              const ref = live.current.placeOfLine(trees, file, line);
              if (ref === null) return null;
              // The run continues the line before it, or resumes after the
              // structural view drew another run between.
              const headed = earlier.some((each) => {
                const was = live.current.placeOfLine(trees, file, each);
                return was !== null && sameRun(was, ref);
              });
              if (headed) return null;
              const drawn = places.find(
                (each) =>
                  placeKey(each.ref) === placeKey(ref) && each.path === path,
              );
              if (drawn === undefined) return null;
              return (
                <Heading
                  {...live.current.headingParts(row, drawn, line.anchor.side)}
                />
              );
            },
            token: (text, line) =>
              live.current.wordsIn(text, line, trees, file),
          };
        };
      },
    }),
    [placesOf, components, split, from?.id, to.id, comments, fates],
  );
  const stack = useMemo(
    () => children(enabled ? layer : undefined),
    [children, enabled, layer],
  );

  // A heading numbers its component's places among the headings each row
  // draws, which a fold, the structural view or a gap opening changes
  // without drawing this view again. A run that a hunk boundary splits is
  // headed again; the repeat leaves the message, threads and steps to the
  // first.
  useEffect(() => {
    const root = body.current;
    if (root === null) return;
    let frame = 0;
    const number = () => {
      frame = 0;
      const seen = new Set<string>();
      const groups = new Map<string, HTMLElement[]>();
      const rowsOf = new Map<Element, number>();
      for (const each of root.querySelectorAll<HTMLElement>(
        "[data-components-key]",
      )) {
        const column = each.closest(".diff-line--before")
          ? "before"
          : each.closest(".diff-line--after")
            ? "after"
            : "one";
        const row = each.closest(".commit-stack__row");
        if (row !== null && !rowsOf.has(row)) rowsOf.set(row, rowsOf.size);
        const where = `${rowsOf.get(row ?? root) ?? -1}|${each.dataset.componentsKey}|${each.dataset.path}`;
        const again = seen.has(`${where}|${column}`);
        seen.add(`${where}|${column}`);
        each.toggleAttribute("data-components-again", again);
        if (again || each.querySelector(".components-heading__count") === null)
          continue;
        const group = `${rowsOf.get(row ?? root) ?? -1}|${each.dataset.componentsId}`;
        groups.set(group, [...(groups.get(group) ?? []), each]);
      }
      for (const group of groups.values()) {
        group.forEach((each, index) => {
          const count = each.querySelector(".components-heading__count");
          const text = `${index + 1} of ${group.length}`;
          if (count !== null && count.textContent !== text) {
            count.textContent = text;
          }
          each
            .querySelector(".components-heading__places")
            ?.toggleAttribute("hidden", group.length < 2);
        });
      }
    };
    const observer = new MutationObserver(() => {
      if (frame === 0) frame = requestAnimationFrame(number);
    });
    observer.observe(root, { childList: true, subtree: true });
    number();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);

  // ---- the rail: the current row's components and files ----
  const shown = !enabled
    ? undefined
    : (rows.find((each) => each.key === current) ??
      rows.find((each) => (placesOf.get(each.key)?.length ?? 0) > 0));
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
      const theirFates = mine.map((each) => fateOf(shown, each));
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
              : // Only the counterpart has it: the newer version adds it, or
                // the older one had it.
                counterparts.direction === "until"
                ? "new"
                : "removed"
          : theirFates.includes("new")
            ? "new"
            : theirFates.includes("removed")
              ? "removed"
              : theirFates.includes("changed")
                ? "changed"
                : theirFates.every((each) => each === "unchanged")
                  ? "unchanged"
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

  // Off, the rail's slots stay empty rather than go, so the stack keeps its
  // place among the children and every file keeps its state.
  return (
    <>
      <div className="components-body" ref={body}>
        {enabled && reading !== null && (
          // The place being read takes a solid bar. A rule rather than a
          // class on its lines, so moving it never draws the diff again.
          <style>{`.diff-file[data-path="${CSS.escape(reading.path)}"] .components-of--${ident(reading.id)} { box-shadow: inset 3px 0 0 var(--component); }`}</style>
        )}
        {enabled && (
          <aside
            className={`components-rail${railSize === null ? "" : " pane--sized"}${railOpen ? "" : " components-rail--closed"}`}
            style={paneSize(railSize)}
          >
            {/* Only a narrow screen draws this; there the rail sits above
                the diff and starts closed, so the review bar stays in view. */}
            <button
              type="button"
              className="components-rail__toggle"
              aria-expanded={railOpen}
              onClick={() => setRailOpen(!railOpen)}
            >
              {railOpen ? "▾" : "▸"} Components{" "}
              {entries.length > 0 && <small>{entries.length}</small>}
            </button>
            <Rail
              loading={shown === undefined || shown.files.status !== "ready"}
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
                  ? () => {
                      rememberHere();
                      showMessage(shown.key, null);
                    }
                  : null
              }
              onGo={(entry) => {
                const drawn = drawnHere.find(
                  (each) => each.ref.component.id === entry.component.id,
                );
                if (drawn !== undefined) {
                  rememberHere();
                  goTo(toPlace(drawn.ref, drawn.path));
                } else if (from === null && shown !== undefined) {
                  rememberHere();
                  toCounterpart(shown, entry.component.id);
                } else if (from !== null) {
                  // Unchanged between versions: read it in the newer one.
                  rememberHere();
                  props.onCompare(null, to.id, null);
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
                if (share.first === null) return;
                rememberHere();
                goTo(toPlace(share.first, path));
              }}
            />
          </aside>
        )}
        {enabled && (
          <Splitter
            pane="components-rail"
            size={railSize}
            onResize={onRailResize}
            label="resize the components rail"
          />
        )}
        <div
          className={`components-main${enabled && trail.length > 0 ? " components-main--trail" : ""}`}
        >
          {stack}
        </div>
      </div>
      {enabled && (
        <Trail
          labels={trail.map((each) => each.label)}
          onBack={back}
          onForget={() => setTrail([])}
        />
      )}
      {enabled && shownPeek !== null && (
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
