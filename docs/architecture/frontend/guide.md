# Guide

A guide is what the author of a series, usually an agent, writes to help a
reader through it: each commit's changes grouped into the ideas they carry,
with a note on each part.

## The guide

A guide belongs to one version of a series, since its stops name line
numbers that only that version's commits have. It sits in the
[review document](review.md#review-state) beside the reader's marks and
comments, so the agent writes it through the same [store](../backend/review-store.md)
and every open screen hears about it.

An idea belongs to one commit. A reader reads a series commit by commit, and
an idea spanning commits would ask them to hold two versions of the same file
at once.

A stop with no lines covers its whole file, and one with no path is the
commit's message, so the agent can point at the message without quoting it.

```ts
//| id: frontend-model-guide
//| file: src/frontend/model/guide.ts
import * as z from "zod";

/** A place a guide points the reader at: lines of one file a commit
 *  changes, the whole file without lines, or the commit's message without a
 *  path. Lines count from 1 on `side`, both ends included. */
export const GuideStop = z.object({
  path: z.string().optional(),
  side: z.enum(["before", "after"]).default("after"),
  start: z.number().int().positive().optional(),
  end: z.number().int().positive().optional(),
  note: z.string(),
});
export type GuideStop = z.infer<typeof GuideStop>;

/** One idea of one commit, as the stops that make it up, in reading order. */
export const GuideIdea = z.object({
  commitId: z.string(),
  title: z.string(),
  note: z.string().default(""),
  stops: z.array(GuideStop),
});
export type GuideIdea = z.infer<typeof GuideIdea>;

/** What the author of a series wants a reader to take from one version of
 *  it, idea by idea. */
export const Guide = z.object({
  series: z.string(),
  version: z.string(),
  author: z.string(),
  writtenAt: z.string(),
  /** Each commit's ideas in the order they read best, commits in any order. */
  ideas: z.array(GuideIdea),
});
export type Guide = z.infer<typeof Guide>;

/** The guide to one version of a series, if one was written. */
export function guideTo(
  guides: Guide[],
  series: string,
  version: string,
): Guide | undefined {
  return guides.find(
    (guide) => guide.series === series && guide.version === version,
  );
}

/** `guides` with `guide` in place of any guide to the same version. */
export function withGuide(guides: Guide[], guide: Guide): Guide[] {
  return [
    ...guides.filter(
      (kept) => kept.series !== guide.series || kept.version !== guide.version,
    ),
    guide,
  ];
}
```

```ts
//| id: frontend-model-guide-test
//| file: src/frontend/model/guide.test.ts
import { describe, expect, test } from "bun:test";
import type { Guide } from "./guide";
import {
  applyCommand,
  EMPTY_REVIEW,
  type ReviewCommand,
  type ReviewDocument,
} from "./review";

function applied(
  document: ReviewDocument,
  ...commands: ReviewCommand[]
): ReviewDocument {
  return commands.reduce(applyCommand, document);
}

function guide(version: string, title: string, series = "local:x"): Guide {
  return {
    series,
    version,
    author: "claude",
    writtenAt: "t",
    ideas: [{ commitId: "c1", title, note: "", stops: [] }],
  };
}

describe("guides", () => {
  test("replace the guide to the same version and keep the others", () => {
    // arrange
    const document = applied(
      EMPTY_REVIEW,
      { kind: "write-guide", guide: guide("1", "first") },
      { kind: "write-guide", guide: guide("2", "second") },
    );

    // act
    const rewritten = applied(document, {
      kind: "write-guide",
      guide: guide("1", "again"),
    });

    // assert
    expect(
      rewritten.guides.map((kept) => [kept.version, kept.ideas[0]?.title]),
    ).toEqual([
      ["2", "second"],
      ["1", "again"],
    ]);
  });

  test("are purged with the review they guide", () => {
    // arrange
    const document = applied(
      EMPTY_REVIEW,
      {
        kind: "register",
        name: "x",
        version: {
          operation: "o",
          revset: "x",
          commits: [],
          registeredAt: "t",
        },
      },
      { kind: "write-guide", guide: guide("1", "mine") },
      { kind: "write-guide", guide: guide("1", "theirs", "local:y") },
      { kind: "forget-review", name: "x", at: "2026-10-01" },
    );

    // act
    const purged = applied(document, {
      kind: "purge-forgotten",
      before: "2026-10-02",
    });

    // assert
    expect(purged.guides.map((kept) => kept.series)).toEqual(["local:y"]);
  });

  test("keep what the document has when an import brings another", () => {
    // arrange
    const held = applied(EMPTY_REVIEW, {
      kind: "write-guide",
      guide: guide("1", "held"),
    });
    const incoming = applied(
      EMPTY_REVIEW,
      { kind: "write-guide", guide: guide("1", "incoming") },
      { kind: "write-guide", guide: guide("2", "new") },
    );

    // act
    const document = applied(held, { kind: "import", document: incoming });

    // assert
    expect(document.guides.map((kept) => kept.ideas[0]?.title)).toEqual([
      "held",
      "new",
    ]);
  });
});
```

## Reading a commit

A guided read is a [series screen](pull-requests.md#series-review-controller) with the
guide to the version on its right laid over the stack. Every comparison,
interdiff, comment, mark, and layout the series screens have, it has, because
it is those screens. `guidedCommit` lays the guide over one row's diff: every
line takes the colour of the first idea whose stop covers it, and a stop with
no lines covers every line of its file's hunks. Lines no stop covers stay
plain, and so does all of a commit the guide skips. The guide colours the
diff; it never decides what is shown or in what order.

Ordering the hunks by idea, the way the guide tells its story, was the
alternative. It loses because code reads top to bottom through a file, and a
hunk read out of place has lost what it calls and what calls it. The story
still shows, as colour on the lines in their own places.

A stop is matched by line anchors, a side and a number, the same ones
comments use, rather than by a row list of its own. So the colour follows a
line into either column of a side-by-side diff, into the structural view,
and into context the reader opens. Read against an older version, a row's
before side is that version, whose numbers the guide's before-side stops do
not count, so only after-side stops colour an interdiff.

Each idea takes the next of five colours, and a sixth idea repeats the first:
a commit with more ideas than that is better split than coloured.

```ts
//| id: frontend-model-guided
//| file: src/frontend/model/guided.ts
import type { FileDiff } from "./diff";
import type { GuideIdea, GuideStop } from "./guide";
import { readPatch } from "./patch";
import type { LineAnchor } from "./review";

/** A line as a diff draws it: where it sits, and its before-side number
 *  where it has one. */
export interface GuidedLine {
  anchor: LineAnchor;
  beforeLine: number | null;
}

export function lineKey({ side, line }: LineAnchor): string {
  return `${side}:${line}`;
}

/** The lines one stop covers: a run on one side, and lines named outright,
 *  which are a whole file's hunks or the lines a run's first line replaced. */
export interface Cover {
  side: "before" | "after";
  start: number;
  end: number;
  also: ReadonlySet<string>;
}

export function covers(cover: Cover, { anchor, beforeLine }: GuidedLine) {
  if (cover.also.has(lineKey(anchor))) return true;
  const line = cover.side === "after" ? anchor.line : beforeLine;
  if (cover.side === "after" && anchor.side !== "after") return false;
  return line !== null && cover.start <= line && line <= cover.end;
}

/** One line of a patch, with its kind. */
interface PatchLine extends GuidedLine {
  changed: boolean;
}

function patchLines(patch: string): PatchLine[] {
  return readPatch(patch).hunks.flatMap((hunk) =>
    hunk.lines.flatMap((line): PatchLine[] => {
      if (line.kind === "note") return [];
      if (line.kind === "removed") {
        return [
          {
            anchor: { side: "before", line: line.oldLine },
            beforeLine: line.oldLine,
            changed: true,
          },
        ];
      }
      return [
        {
          anchor: { side: "after", line: line.newLine },
          beforeLine: line.kind === "context" ? (line.oldLine ?? null) : null,
          changed: line.kind === "added",
        },
      ];
    }),
  );
}

export function pathOf(file: FileDiff): string {
  return "path" in file ? file.path : file.newPath;
}

function oldPathOf(file: FileDiff): string {
  return "path" in file ? file.path : file.oldPath;
}

/** What `stop` covers in a file whose patch has `lines`. A stop with no
 *  lines covers every hunk of its file. A run takes in the lines its first
 *  line replaced, which sit just above it as removed lines. */
export function coverOf(stop: GuideStop, lines: PatchLine[]): Cover {
  if (stop.start === undefined) {
    return {
      side: "after",
      start: 1,
      end: 0,
      also: new Set(lines.map((line) => lineKey(line.anchor))),
    };
  }
  const run: Cover = {
    side: stop.side,
    start: stop.start,
    end: stop.end ?? stop.start,
    also: new Set(),
  };
  const first = lines.findIndex((line) => covers(run, line));
  const also = new Set<string>();
  for (let at = first - 1; at >= 0; at--) {
    const line = lines[at];
    if (line === undefined || line.anchor.side !== "before") break;
    also.add(lineKey(line.anchor));
  }
  return { ...run, also };
}

/** The colours ideas take in the order the guide lists them, over again
 *  past the fifth. */
export const IDEA_COLOURS = [
  "blue",
  "amber",
  "green",
  "purple",
  "teal",
] as const;
export type IdeaColour = (typeof IDEA_COLOURS)[number];

export interface GuidedIdea {
  title: string;
  note: string;
  colour: IdeaColour;
  /** How many of its stops the guide wrote. */
  stops: number;
}

/** What the guide says at one stop. */
export interface GuidedNote {
  /** Unique across the commits of a version. */
  key: string;
  /** The idea's index in the commit's ideas. */
  idea: number;
  /** The stop's index in its idea. */
  stop: number;
  note: string;
  /** The file it is about, or null for the commit's message. */
  path: string | null;
  /** The lines it is about, and the line its tab goes on. */
  cover: Cover | null;
  anchor: LineAnchor | null;
}

/** One file of the commit, for the rail: its size, and the idea each of
 *  its changed lines belongs to, in patch order. */
export interface GuidedFile {
  path: string;
  added: number;
  removed: number;
  owners: (number | null)[];
}

export interface GuidedCommit {
  commitId: string;
  /** In the order the diff lists them. */
  files: GuidedFile[];
  ideas: GuidedIdea[];
  /** Each file's stops, in the guide's order, by after-side path. */
  covers: Map<string, { idea: number; cover: Cover }[]>;
  notes: GuidedNote[];
}

/** The idea a drawn line of `path` belongs to: the first whose stop covers
 *  it, or null for none. */
export function ideaOf(
  commit: GuidedCommit,
  path: string,
  line: GuidedLine,
): number | null {
  return (
    commit.covers.get(path)?.find(({ cover }) => covers(cover, line))?.idea ??
    null
  );
}

/** A commit's diff read with its guide: each line takes the colour of the
 *  first idea whose stop covers it, and each stop's note sits at the first
 *  line it changes. Read against an older version of the commit rather
 *  than its parent, `beforeSide` is false: the before side is then the old
 *  version, which the guide's before-side numbers do not count. */
export function guidedCommit(
  commitId: string,
  files: FileDiff[],
  ideas: GuideIdea[],
  { beforeSide }: { beforeSide: boolean },
): GuidedCommit {
  const linesOf = new Map(
    files.map((file) => [pathOf(file), patchLines(file.patch)]),
  );
  const byPath = (path: string) =>
    files.find((file) => pathOf(file) === path || oldPathOf(file) === path);
  const coversOf = new Map<string, { idea: number; cover: Cover }[]>();
  const taken = new Map<string, Set<string>>();

  const notes = ideas.flatMap((idea, ideaIndex) =>
    idea.stops.flatMap((stop, stopIndex): GuidedNote[] => {
      const key = `${commitId}:${ideaIndex}.${stopIndex}`;
      const base = { key, idea: ideaIndex, stop: stopIndex, note: stop.note };
      if (stop.path === undefined) {
        return [{ ...base, path: null, cover: null, anchor: null }];
      }
      const file = byPath(stop.path);
      if (file === undefined) return [];
      const path = pathOf(file);
      if (!beforeSide && stop.side === "before" && stop.start !== undefined) {
        return [{ ...base, path, cover: null, anchor: null }];
      }
      const lines = linesOf.get(path) ?? [];
      const cover = coverOf(stop, lines);
      coversOf.set(path, [
        ...(coversOf.get(path) ?? []),
        { idea: ideaIndex, cover },
      ]);
      const used = taken.get(path) ?? new Set<string>();
      taken.set(path, used);
      const anchor = anchorIn(cover, lines, used);
      used.add(lineKey(anchor));
      return [{ ...base, path, cover, anchor }];
    }),
  );

  const guided: GuidedCommit = {
    commitId,
    files: [],
    ideas: ideas.map((idea, index) => ({
      title: idea.title,
      note: idea.note,
      colour: IDEA_COLOURS[index % IDEA_COLOURS.length] ?? "blue",
      stops: idea.stops.length,
    })),
    covers: coversOf,
    notes,
  };
  guided.files = files.map((file) => {
    const path = pathOf(file);
    const changed = (linesOf.get(path) ?? []).filter((line) => line.changed);
    return {
      path,
      added: changed.filter((line) => line.anchor.side === "after").length,
      removed: changed.filter((line) => line.anchor.side === "before").length,
      owners: changed.map((line) => ideaOf(guided, path, line)),
    };
  });
  return guided;
}

/** The line a note's tab goes on: the first line it covers that changes,
 *  so the tab marks the change rather than the context above it, and the
 *  next one along when another note's tab is already there. A stop none of
 *  whose lines the patch shows starts at its first line, out of sight
 *  until the reader opens the lines around it. */
function anchorIn(
  cover: Cover,
  lines: PatchLine[],
  used: Set<string>,
): LineAnchor {
  const mine = lines.filter((line) => covers(cover, line));
  const free = mine.filter((line) => !used.has(lineKey(line.anchor)));
  return (
    free.find((line) => line.changed)?.anchor ??
    free[0]?.anchor ??
    mine[0]?.anchor ?? { side: cover.side, line: cover.start }
  );
}
```

```ts
//| id: frontend-model-guided-test
//| file: src/frontend/model/guided.test.ts
import { describe, expect, test } from "bun:test";
import type { FileDiff } from "./diff";
import type { GuideIdea } from "./guide";
import { coverOf, covers, guidedCommit, ideaOf } from "./guided";

function diff(path: string, patch: string): FileDiff {
  return {
    status: "modified",
    path,
    binary: false,
    oldBlob: "a",
    newBlob: "b",
    patch,
    structural: { kind: "unavailable", reason: "test" },
  };
}

// Line 2 is rewritten and line 21 added, in a file 23 lines long.
const STORE = diff(
  "store.ts",
  `--- a/store.ts
+++ b/store.ts
@@ -1,3 +1,3 @@
 one
-two
+TWO
 three
@@ -20,2 +20,3 @@
 twenty
+twenty-one
 twenty-two
`,
);

const API = diff(
  "api.ts",
  `--- a/api.ts
+++ b/api.ts
@@ -5,2 +5,3 @@
 five
+  six
 seven
`,
);

function idea(title: string, ...stops: GuideIdea["stops"]): GuideIdea {
  return { commitId: "c1", title, note: "", stops };
}

const after = (line: number, beforeLine: number | null = null) => ({
  anchor: { side: "after" as const, line },
  beforeLine,
});
const before = (line: number) => ({
  anchor: { side: "before" as const, line },
  beforeLine: line,
});

describe("coverOf", () => {
  test("takes in the lines a stop's first line replaced", () => {
    // arrange
    const commit = guidedCommit(
      "c1",
      [STORE],
      [idea("Rename", { path: "store.ts", side: "after", start: 2, note: "" })],
      { beforeSide: true },
    );
    const cover = commit.notes[0]?.cover;
    if (cover == null) throw new Error("no cover");

    // act
    // assert
    expect(covers(cover, before(2))).toBe(true);
    expect(covers(cover, after(2))).toBe(true);
    expect(covers(cover, after(3, 3))).toBe(false);
  });

  test("covers every line of a file's hunks for a stop with no lines", () => {
    // arrange
    // act
    const cover = coverOf({ path: "store.ts", side: "after", note: "" }, []);

    // assert
    expect(covers(cover, after(1, 1))).toBe(false);
  });
});

describe("guidedCommit", () => {
  test("colours lines by the first idea on them, and places notes", () => {
    // arrange
    // act
    const commit = guidedCommit(
      "c1",
      [API, STORE],
      [
        idea("Rename", {
          path: "store.ts",
          side: "after",
          start: 2,
          note: "a",
        }),
        idea(
          "Everything",
          { path: "store.ts", side: "after", note: "b" },
          { side: "after", note: "the message" },
        ),
      ],
      { beforeSide: true },
    );

    // assert
    expect(commit.files.map((file) => file.path)).toEqual([
      "api.ts",
      "store.ts",
    ]);
    expect(commit.ideas.map((each) => each.colour)).toEqual(["blue", "amber"]);
    expect(ideaOf(commit, "store.ts", after(1, 1))).toBe(1);
    expect(ideaOf(commit, "store.ts", before(2))).toBe(0);
    expect(ideaOf(commit, "store.ts", after(2))).toBe(0);
    expect(ideaOf(commit, "store.ts", after(10, 10))).toBeNull();
    expect(ideaOf(commit, "store.ts", after(21))).toBe(1);
    expect(ideaOf(commit, "api.ts", after(6))).toBeNull();
    expect(commit.files[1]?.owners).toEqual([0, 0, 1]);
    expect(
      commit.notes.map(({ key, path, anchor }) => ({ key, path, anchor })),
    ).toEqual([
      { key: "c1:0.0", path: "store.ts", anchor: { side: "before", line: 2 } },
      { key: "c1:1.0", path: "store.ts", anchor: { side: "after", line: 2 } },
      { key: "c1:1.1", path: null, anchor: null },
    ]);
  });

  test("drops a stop on a file the commit does not have", () => {
    // arrange
    // act
    const commit = guidedCommit(
      "c1",
      [STORE],
      [idea("Lost", { path: "gone.ts", side: "after", note: "a" })],
      { beforeSide: true },
    );

    // assert
    expect(commit.notes).toEqual([]);
    expect(commit.files[0]?.owners.every((owner) => owner === null)).toBe(true);
  });

  test("leaves before-side lines alone against an older version", () => {
    // arrange
    // act
    const commit = guidedCommit(
      "c1",
      [STORE],
      [idea("Old", { path: "store.ts", side: "before", start: 2, note: "a" })],
      { beforeSide: false },
    );

    // assert
    expect(ideaOf(commit, "store.ts", before(2))).toBeNull();
    expect(commit.notes.map((note) => note.anchor)).toEqual([null]);
  });
});
```

## The tabs

Local guided and Pull guided sit beside the screens they guide, at the same
places under `/guided`, and render those screens with a guide on. The lists
mark which series have a guide to their newest version, and a guided read
links to the same place without the guide as the classic view.

```tsx
//| id: frontend-screen-guided
//| file: src/frontend/screens/GuidedScreen.tsx
import { LocalReviews } from "../controllers/LocalReviews";
import { PullRequests } from "../controllers/PullRequests";
import { type Place, tabPlace } from "../model/place";
import type { Visit } from "../state/place";
import { useReviewContext } from "../state/review";
import { useSettingsContext } from "../state/settings";
import { ModeTabs } from "../views/ModeTabs";
import { ReviewStrip } from "../views/ReviewStrip";

/** The local review and pull request screens with each version's guide laid
 *  over its stack. */
export function GuidedScreen({
  place,
  onGo,
}: {
  place: Extract<Place, { tab: "local-guided" | "pull-guided" }>;
  onGo: (place: Place, visit?: Visit) => void;
}) {
  const review = useReviewContext();
  const { settings, setGuideNotes } = useSettingsContext();
  const guiding = {
    notes: { at: settings.display.guideNotes, onChange: setGuideNotes },
  };

  return (
    <div className="app">
      <ModeTabs
        mode={place.tab}
        onSelect={(mode) => {
          if (mode === place.tab) return;
          // The screen of the series being read opens on the same place.
          if (mode === "reviews" && place.tab === "local-guided") {
            onGo({ tab: "reviews", review: place.review });
          } else if (mode === "pulls" && place.tab === "pull-guided") {
            onGo({ tab: "pulls", pull: place.pull });
          } else onGo(tabPlace(mode));
        }}
      />
      <ReviewStrip
        unavailable={review.status === "unavailable" ? review.message : null}
        failure={review.failure}
        onDismiss={review.dismissFailure}
      />
      {place.tab === "local-guided" ? (
        <LocalReviews
          place={place.review}
          review={review}
          guiding={guiding}
          onGo={(next, visit) =>
            onGo({ tab: "local-guided", review: next }, visit)
          }
        />
      ) : (
        <PullRequests
          place={place.pull}
          review={review}
          guiding={guiding}
          onGo={(next, visit) =>
            onGo({ tab: "pull-guided", pull: next }, visit)
          }
        />
      )}
    </div>
  );
}
```

`SeriesReview` makes three changes on a guided read. Every row starts open
but the ones the stack folds to a line, so the version reads in one scroll.
A row's highlighting waits until it has been on screen, as a plain read's
waits for the reader to open it. Diffs load one at a time, the current row's
first: a large commit's diff takes seconds, and asking for every one at once
can keep one waiting past the server's timeout.

## The guided view

`GuidedStack` wraps the [commit stack](commit-stack.md) and hands it a
`StackLayer`, which reaches each file's lines through the
[diff view's](diff.md#line-decor) `LineDecor`. The stack and the diff stay
unaware of guides, and the layer stays unaware of how a line is drawn.

The rail beside the stack is the current commit at a glance: who wrote the
guide, its ideas, then each file with a strip of the ideas its changes belong
to. Picking an idea fades the lines of the others rather than hiding them, so
the file still reads whole. `j` and `k` step through the runs of changes, and
a digit picks a commit.

```tsx
//| id: frontend-view-guided
//| file: src/frontend/views/Guided/GuidedStack.tsx
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
```

```css
/*| id: design-guided
@layer components {
  /* An idea's colour, as a line in the gutter and a tint behind its notes. */
  .idea--blue {
    --idea: var(--blue-600);
  }

  .idea--amber {
    --idea: var(--amber-600);
  }

  .idea--green {
    --idea: var(--green-600);
  }

  .idea--purple {
    --idea: var(--purple-600);
  }

  .idea--teal {
    --idea: var(--teal-600);
  }

  [class*="idea--"] {
    --idea-surface: color-mix(in srgb, var(--idea) 10%, transparent);
  }

  .guided-faint {
    font-weight: normal;
    color: var(--text-faint);
  }

  .guided-added {
    color: var(--diff-added);
  }

  .guided-removed {
    color: var(--diff-removed);
  }

  .guided-rail__head {
    margin: var(--space-4) var(--space-2) var(--space-3);
    font-size: var(--text-size-small);
    color: var(--text-muted);
    text-transform: uppercase;
  }

  .guided-rail__head:first-child {
    margin-top: 0;
  }

  .guided-file {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--space-1) var(--space-3);
    width: 100%;
    padding: var(--space-2) var(--space-3);
    font: inherit;
    color: var(--text);
    text-align: left;
    cursor: pointer;
    background: none;
    border: 1px solid transparent;
    border-radius: var(--radius);
  }

  .guided-file:hover,
  .guided-file--on {
    background: var(--surface);
    border-color: var(--border);
  }

  /* Ellipsis on the left, so the file name stays when the path is long. */
  .guided-file__path {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    direction: rtl;
  }

  .guided-file__size {
    font-size: var(--text-size-small);
  }

  .guided-file--plain .guided-file__path {
    color: var(--text-muted);
  }

  .guided-strip {
    display: flex;
    grid-column: 1 / -1;
    gap: 1px;
    height: 3px;
  }

  .guided-strip i {
    min-width: 3px;
    background: var(--idea);
    border-radius: 1px;
  }

  .guided-strip .guided-strip--plain {
    background: var(--border);
  }

  .guided-strip .guided-strip--off {
    opacity: 0.2;
  }

  .guided-idea {
    display: flex;
    gap: var(--space-3);
    align-items: baseline;
    width: 100%;
    padding: var(--space-2) var(--space-3);
    font: inherit;
    font-weight: bold;
    color: var(--text);
    text-align: left;
    cursor: pointer;
    background: none;
    border: 1px solid transparent;
    border-radius: var(--radius);
  }

  .guided-idea:hover {
    background: var(--surface);
  }

  .guided-idea--on {
    background: var(--idea-surface);
    border-color: var(--idea);
  }

  .guided-idea--off {
    opacity: 0.45;
  }

  .guided-dot {
    display: inline-block;
    flex: none;
    width: 0.7em;
    height: 0.7em;
    background: var(--idea);
    border-radius: 50%;
  }

  /* The rail stands beside the stack in the scrolling pane, as tall as the
     pane, so it stays in view the whole way down. */
  .guided-body {
    display: grid;
    grid-template-columns: 20em minmax(0, 1fr);
    align-items: start;
  }

  .guided-rail {
    position: sticky;
    top: 0;
    max-height: var(--guided-rail-height, 100vh);
    padding: var(--space-4);
    overflow: auto;
    background: var(--surface-sunken);
    border-right: 1px solid var(--border);
  }

  .guided-rail__by {
    margin: 0 var(--space-2) var(--space-3);
  }

  .guided-main {
    min-width: 0;
  }

  .guided-chip {
    padding: 0 var(--space-2);
    font-size: var(--text-size-small);
    color: var(--text-inverse);
    background: var(--accent);
    border-radius: var(--radius);
  }

  /* The idea's line runs down the edge of the gutter, faint beside
     context, solid beside the lines it changes. */
  .guided-line .diff-line__gutter {
    box-shadow: 4px 0 color-mix(in srgb, var(--idea) 25%, transparent);
  }

  .guided-line:is(.diff-line--added, .diff-line--removed) .diff-line__gutter {
    color: var(--idea);
    box-shadow: 4px 0 var(--idea);
  }

  .guided-line--dim {
    opacity: 0.5;
  }

  .guided-line--dim .diff-line__gutter {
    box-shadow: 4px 0 var(--border-subtle);
  }

  .guided-line--lit {
    background-image: linear-gradient(var(--idea-surface), var(--idea-surface));
  }
}

@layer components-narrow {
  @media (max-width: 760px) {
    .guided-body {
      grid-template-columns: minmax(0, 1fr);
    }

    .guided-rail {
      position: static;
      max-height: 30vh;
      border-right: 0;
      border-bottom: 1px solid var(--border);
    }
  }
}
```

## Notes

A tab in the sign column marks the line a note starts on, so the diff reads
uninterrupted and the reader opens a note when they want it. Pointing at a tab
peeks at its note; pressing it opens the note under that line, the way a
review comment opens under its line. A stop can run for tens of lines, and a
note after its last line, where a comment on a range would sit, would be far
from its tab. A note whose line the diff does not show sits above the file
until the reader opens the context around it. `c` opens or closes every note.

A reader can have notes open in a margin instead, level with their lines and
pushed down only where one would overlap the one above. `m` switches. The
choice is a [setting](settings.md#display), since it is how a reader likes to
read rather than anything about one series. A phone has no room for a margin,
so its notes open under their lines whatever the setting says.

```tsx
//| id: frontend-view-guided-notes
//| file: src/frontend/views/Guided/Notes.tsx
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
```

```css
/*| id: design-guided
@layer components {
  .guided-bar {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    align-items: center;
    padding: 0 var(--space-2) var(--space-3);
  }

  .guided-switch {
    display: inline-flex;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }

  .guided-switch button,
  .guided-button {
    padding: var(--space-1) var(--space-3);
    font: inherit;
    color: var(--text-muted);
    cursor: pointer;
    background: var(--surface);
    border: 0;
  }

  .guided-switch button + button {
    border-left: 1px solid var(--border);
  }

  .guided-switch button[aria-pressed="true"] {
    color: var(--text-inverse);
    background: var(--text);
  }

  .guided-button {
    padding: var(--space-1) var(--space-3);
    font: inherit;
    color: var(--text-muted);
    cursor: pointer;
    background: var(--surface);
    border: 0;
  }

  .guided-message__notes {
    display: flex;
    gap: var(--space-2);
    align-items: center;
    margin-bottom: var(--space-3);
  }

  /* A tab sits in the sign column of the row a note is on, in place of the
     row's + or -. */
  .guided-tab {
    min-width: 1.5em;
    height: 1.35em;
    padding: 0 var(--space-1);
    font: inherit;
    font-size: var(--text-size-small);
    font-weight: bold;
    line-height: 1.35em;
    color: var(--idea);
    cursor: pointer;
    background: var(--idea-surface);
    border: 0;
    border-radius: var(--radius);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--idea) 60%, transparent);
  }

  .guided-tab:hover,
  .guided-tab--open {
    color: var(--text-inverse);
    background: var(--idea);
    box-shadow: none;
  }

  .guided-tab--off {
    opacity: 0.25;
  }

  .guided-note {
    max-width: 60em;
    padding: var(--space-3) var(--space-4);
    margin: var(--space-2) var(--space-5) var(--space-3) 10.5em;
    line-height: var(--text-line-height);
    white-space: normal;
    background: var(--surface);
    border: 1px solid var(--border-subtle);
    border-left: 3px solid var(--idea);
    border-radius: var(--radius);
  }

  .guided-note--lit {
    background: var(--idea-surface);
  }

  .guided-note--off {
    opacity: 0.35;
  }

  .guided-note__head {
    display: flex;
    flex-wrap: wrap;
    gap: 0 var(--space-3);
    align-items: center;
  }

  .guided-note__head .guided-faint {
    white-space: nowrap;
  }

  .guided-note__idea {
    color: var(--idea);
  }

  .guided-note__hide {
    padding: 0;
    font: inherit;
    color: var(--text-faint);
    cursor: pointer;
    background: none;
    border: 0;
  }

  .guided-note__text {
    margin: var(--space-1) 0 0;
  }

  .guided-note__grow {
    flex: 1;
  }

  .guided-margin {
    position: relative;
    border-left: 1px solid var(--border-subtle);
  }

  .guided-margin .guided-note {
    position: absolute;
    right: var(--space-3);
    left: var(--space-3);
    margin: 0;
    font-size: var(--text-size-small);
    border-color: transparent;
    border-left-color: color-mix(in srgb, var(--idea) 50%, transparent);
  }

  .guided-margin .guided-note--lit {
    border-left-color: var(--idea);
  }

  .guided-peek {
    position: fixed;
    z-index: 30;
    padding: var(--space-3) var(--space-4);
    line-height: var(--text-line-height);
    pointer-events: none;
    background: var(--surface);
    border: 1px solid var(--border);
    border-left: 3px solid var(--idea);
    border-radius: var(--radius);
    box-shadow: 0 6px 20px rgb(0 0 0 / 15%);
  }

  .guided-message {
    padding: 0 var(--space-4) var(--space-3);
  }

  .guided-message .guided-note {
    margin-left: 0;
  }

  /* An open note sits under its line, past the gutter, and stays put when
     the patch scrolls sideways, as a line's comments do. */
  .diff-file__line-note {
    position: sticky;
    left: 0;
    grid-column: 1 / -1;
    white-space: normal;
  }

  .diff-file__line-note .guided-note {
    margin-left: calc(var(--gutter-width) + var(--space-4));
  }

  .diff-file__beside {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 20em;
  }

  .guided-line .diff-line__sign {
    display: inline-block;
    min-width: 1.6em;
  }
}

@layer components-narrow {
  @media (max-width: 1100px) {
    .diff-file__beside {
      grid-template-columns: minmax(0, 1fr) 14em;
    }
  }

  /* A phone opens notes under their lines, so it has nothing to switch. */
  @media (max-width: 760px) {
    .guided-switch {
      display: none;
    }

    .diff-file__line-note .guided-note {
      margin-right: var(--space-2);
      margin-left: var(--space-2);
    }
  }
}
```
