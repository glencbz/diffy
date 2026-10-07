# Tour

A guide is what the author of a series, usually an agent, writes to walk a
reader through it: each commit's changes grouped into the ideas they carry,
and the links from one commit's ideas to another's.

## The guide

A guide belongs to one version of a series, since its stops name line
numbers that only that version's commits have. It sits in the
[review document](review.md#review-state) beside the reader's marks and
comments, so the agent writes it through the same [store](../backend/review-store.md)
and every open screen hears about it.

An idea belongs to one commit. Reading a series commit by commit is what the
commit stack already does well, and an idea spanning commits would ask the
reader to hold two versions of the same file at once. What spans commits is
a link: one idea relying on another, such as a refactor in the first commit
that a feature in the third is built on. A link joins two ideas rather than
two stops, because the reader follows it to read the other idea, and an idea
is the smallest thing that reads on its own.

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
  /** Unique within the guide, so a link can name it. */
  id: z.string().min(1),
  commitId: z.string(),
  title: z.string(),
  note: z.string().default(""),
  stops: z.array(GuideStop),
});
export type GuideIdea = z.infer<typeof GuideIdea>;

/** One idea relying on another, usually a later commit's payoff on an
 *  earlier commit's setup, and what the link says about why. */
export const GuideLink = z.object({
  from: z.string(),
  to: z.string(),
  say: z.string(),
});
export type GuideLink = z.infer<typeof GuideLink>;

/** What the author of a series wants a reader to take from one version of
 *  it, idea by idea. */
export const Guide = z.object({
  series: z.string(),
  version: z.string(),
  author: z.string(),
  writtenAt: z.string(),
  /** Each commit's ideas in the order they read best, commits in any order. */
  ideas: z.array(GuideIdea),
  links: z.array(GuideLink).default([]),
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
    ideas: [{ id: "a", commitId: "c1", title, note: "", stops: [] }],
    links: [],
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

The tour reads one commit at a time, the newest version's oldest first, and a
commit reads idea by idea: the guide's ideas for it in the guide's order,
each as one card per stop. A card draws its stop's rows with a few around
them and folds the rest of the file, and the rows come from the whole file
rather than the patch, so a fold opens onto lines the patch left out.

Every hunk no stop covers still reads, after the guide's ideas, as one idea
per file. A guide is the agent's reading of its work, and a reviewer who
could only see what it chose to show would be reviewing the guide. A series
with no guide reads the same way, file by file, so the tab works before any
agent has written one.

File order lays the same cards out by file and by line, for the reader who
wants to check the whole of a file rather than follow the story.

```ts
//| id: frontend-model-tour
//| file: src/frontend/model/tour.ts
import type { FileDiff } from "./diff";
import type { Guide, GuideIdea, GuideStop } from "./guide";
import { gapsOf, readPatch } from "./patch";

/** One line of a file as a commit leaves it, with the lines it removed in
 *  place. `code` is the patch's text, which only lines in a hunk have; the
 *  rest are read off the file itself. */
export interface FileRow {
  kind: "context" | "added" | "removed";
  old: number | null;
  new: number | null;
  code: string | null;
}

/** Rows `[first, last]`, both included. */
export type Span = readonly [number, number];

export interface TourFile {
  /** The after-side path, or the before side's for a deleted file. */
  path: string;
  oldPath: string;
  diff: FileDiff;
  rows: FileRow[];
  /** Each hunk's rows, context included, in file order. */
  hunks: Span[];
}

export function pathOf(file: FileDiff): string {
  return "path" in file ? file.path : file.newPath;
}

function oldPathOf(file: FileDiff): string {
  return "path" in file ? file.path : file.oldPath;
}

/** Every row of `file`, given how long its after side is. Without the
 *  length, the rows stop after the last hunk. */
export function tourFile(file: FileDiff, length: number | null): TourFile {
  const patch = readPatch(file.patch);
  const rows: FileRow[] = [];
  const hunks: Span[] = [];
  const last = patch.hunks.at(-1);
  const end =
    length ??
    (last === undefined
      ? 0
      : last.newStart +
        last.lines.filter((line) => "newLine" in line).length -
        1);
  const gaps = file.newBlob === null ? [] : gapsOf(patch, end);

  patch.hunks.forEach((hunk, index) => {
    const gap = gaps[index];
    if (gap !== undefined) pushGap(rows, gap);
    const first = rows.length;
    for (const line of hunk.lines) {
      if (line.kind === "note") continue;
      rows.push({
        kind: line.kind,
        old: line.kind === "added" ? null : (line.oldLine ?? null),
        new: line.kind === "removed" ? null : line.newLine,
        code: line.code,
      });
    }
    if (rows.length > first) hunks.push([first, rows.length - 1]);
  });
  const tail = gaps[patch.hunks.length];
  if (tail !== undefined) pushGap(rows, tail);

  return {
    path: pathOf(file),
    oldPath: oldPathOf(file),
    diff: file,
    rows,
    hunks,
  };
}

function pushGap(
  rows: FileRow[],
  gap: { start: number; count: number; oldStart: number | null },
) {
  for (let i = 0; i < gap.count; i++) {
    rows.push({
      kind: "context",
      new: gap.start + i,
      old: gap.oldStart === null ? null : gap.oldStart + i,
      code: null,
    });
  }
}

/** The rows a stop's lines fall on, with the lines its first line replaced,
 *  or null when none of its lines is in the file. */
export function stopSpan(file: TourFile, stop: GuideStop): Span | null {
  const { start } = stop;
  if (start === undefined) return null;
  const end = stop.end ?? start;
  const side = stop.side === "before" ? "old" : "new";
  let first = -1;
  let last = -1;
  file.rows.forEach((row, index) => {
    const line = row[side];
    if (line === null || line < start || line > end) return;
    if (first === -1) first = index;
    last = index;
  });
  if (first === -1) return null;
  while (first > 0 && file.rows[first - 1]?.kind === "removed") first--;
  return [first, last];
}

function overlaps(a: Span, b: Span): boolean {
  return a[0] <= b[1] && b[0] <= a[1];
}

/** One thing the reader reads in a commit: some rows of one file, or the
 *  commit's message. */
export type TourCard =
  | {
      key: string;
      kind: "file";
      ideaId: string;
      path: string;
      /** What the card is about, which it draws with a few rows around. */
      spans: Span[];
      note: string;
    }
  | { key: string; kind: "message"; ideaId: string; note: string };

export interface TourIdea {
  id: string;
  commitId: string;
  title: string;
  note: string;
  /** Whether the guide wrote it, rather than the tour gathering what the
   *  guide left out. */
  guided: boolean;
  cards: TourCard[];
  /** Lines added and removed in what its cards are about. */
  size: number;
}

export interface TourCommit {
  commitId: string;
  /** 1 for the oldest commit, as the reader sees it. */
  number: number;
  subject: string;
  description: string;
  files: TourFile[];
  ideas: TourIdea[];
}

/** A commit as the tour is handed it: its message, and its diff once that
 *  has loaded. */
export interface CommitInput {
  commitId: string;
  description: string;
  files: TourFile[];
}

const MESSAGE = "message";

function sizeOf(cards: TourCard[], files: Map<string, TourFile>): number {
  let size = 0;
  for (const card of cards) {
    if (card.kind !== "file") continue;
    const rows = files.get(card.path)?.rows ?? [];
    for (const [first, last] of card.spans) {
      for (let i = first; i <= last; i++) {
        if (rows[i]?.kind !== "context") size++;
      }
    }
  }
  return size;
}

/** What one commit reads as: the guide's ideas for it, then one idea per
 *  file for every hunk no stop covers. Without a guide every hunk is left
 *  out, so the commit reads file by file. */
export function tourCommit(
  input: CommitInput,
  number: number,
  ideas: GuideIdea[],
): TourCommit {
  const files = new Map(input.files.map((file) => [file.path, file]));
  const byPath = (path: string) =>
    files.get(path) ?? input.files.find((file) => file.oldPath === path);
  const covered = new Map<string, Span[]>();
  const cover = (path: string, span: Span) =>
    covered.set(path, [...(covered.get(path) ?? []), span]);

  const guided = ideas.map((idea): TourIdea => {
    const cards = idea.stops.flatMap((stop, index): TourCard[] => {
      const key = `${idea.id}#${index}`;
      if (stop.path === undefined) {
        return [{ key, kind: MESSAGE, ideaId: idea.id, note: stop.note }];
      }
      const file = byPath(stop.path);
      if (file === undefined) return [];
      const spans =
        stop.start === undefined
          ? file.hunks
          : [stopSpan(file, stop)].filter((span) => span !== null);
      if (spans.length === 0) return [];
      for (const span of spans) cover(file.path, span);
      return [
        {
          key,
          kind: "file",
          ideaId: idea.id,
          path: file.path,
          spans,
          note: stop.note,
        },
      ];
    });
    return {
      id: idea.id,
      commitId: input.commitId,
      title: idea.title,
      note: idea.note,
      guided: true,
      cards,
      size: sizeOf(cards, files),
    };
  });

  const rest = input.files.flatMap((file): TourIdea[] => {
    const spans = file.hunks.filter(
      (hunk) =>
        !(covered.get(file.path) ?? []).some((span) => overlaps(span, hunk)),
    );
    if (spans.length === 0) return [];
    const id = `${input.commitId}:${file.path}`;
    const cards: TourCard[] = [
      {
        key: `${id}#0`,
        kind: "file",
        ideaId: id,
        path: file.path,
        spans,
        note: "",
      },
    ];
    return [
      {
        id,
        commitId: input.commitId,
        title: file.path,
        note: "",
        guided: false,
        cards,
        size: sizeOf(cards, files),
      },
    ];
  });

  return {
    commitId: input.commitId,
    number,
    subject: input.description.split("\n")[0] || "(no description)",
    description: input.description,
    files: input.files,
    ideas: [...guided, ...rest],
  };
}

/** Every card of a commit in file order: the message first, then each
 *  file's cards from the top of the file down. */
export function fileOrder(commit: TourCommit): TourCard[] {
  const rank = new Map(commit.files.map((file, index) => [file.path, index]));
  const cards = commit.ideas.flatMap((idea) => idea.cards);
  const at = (card: TourCard) =>
    card.kind === MESSAGE
      ? [-1, 0]
      : [rank.get(card.path) ?? 0, card.spans[0]?.[0] ?? 0];
  return [...cards].sort((a, b) => {
    const [fa, ra] = at(a);
    const [fb, rb] = at(b);
    return (fa ?? 0) - (fb ?? 0) || (ra ?? 0) - (rb ?? 0);
  });
}

/** The idea of `commit` whose cards are about `row` of `path`. */
export function ideaAt(
  commit: TourCommit,
  path: string,
  row: number,
): TourIdea | undefined {
  return commit.ideas.find((idea) =>
    idea.cards.some(
      (card) =>
        card.kind === "file" &&
        card.path === path &&
        card.spans.some(([first, last]) => first <= row && row <= last),
    ),
  );
}
```

## Names a commit hands on

A commit that defines a name a later commit uses links the two without anyone
writing the link, the way a wiki lists the pages that mention a page. The
tour finds definitions by a keyword-then-name pattern on added lines, which
is crude but language-agnostic; a symbol index per language would find more
and cost a parser per language. A name has to be long and mixed-case to
count, so `value` or `item` do not link half the code.

Those uses become links between ideas beside the guide's, so the map and the
backlinks show both: what the agent said one idea relies on, and what the
code says.

```ts
//| id: frontend-model-tour
/** Where in a commit a line is. */
export interface Site {
  commitId: string;
  path: string;
  row: number;
}

/** A name one commit adds a definition of, and where later commits use it. */
export interface Introduced {
  name: string;
  at: Site;
  usedAt: Site[];
}

// A definition in most languages diffy reads: a keyword, then the name.
const DEFINITION =
  /\b(?:function|const|let|var|class|type|interface|enum|def|fn|struct|trait|func)\s+([A-Za-z_]\w*)/g;

const PROSE = /\.(md|markdown|rst|txt|adoc)$/;

const TEST_FILE = /(^|[./_-])(test|spec)s?([./_-]|$)/;

/** A name worth linking: long enough and cased enough not to be a word. */
function linkable(name: string): boolean {
  return name.length >= 6 && /[A-Z]/.test(name) && /[a-z]/.test(name);
}

function definitions(code: string): string[] {
  return [...code.matchAll(DEFINITION)].flatMap((match) =>
    match[1] !== undefined && linkable(match[1]) ? [match[1]] : [],
  );
}

/** The names each commit defines that a later commit's added lines use,
 *  earliest definition first. A name a commit removes a definition of too
 *  was moved rather than introduced, and test files define nothing. */
export function introducedNames(commits: TourCommit[]): Introduced[] {
  const found = new Map<string, Introduced>();
  commits.forEach((commit, index) => {
    // Code before prose, so a name a literate document quotes is found where
    // the code defines it.
    const files = [...commit.files].sort(
      (a, b) => Number(PROSE.test(a.path)) - Number(PROSE.test(b.path)),
    );
    for (const file of files) {
      if (TEST_FILE.test(file.path)) continue;
      const removed = new Set(
        file.rows.flatMap((row) =>
          row.kind === "removed" ? definitions(row.code ?? "") : [],
        ),
      );
      file.rows.forEach((row, at) => {
        if (row.kind !== "added") return;
        for (const name of definitions(row.code ?? "")) {
          if (found.has(name) || removed.has(name)) continue;
          found.set(name, {
            name,
            at: { commitId: commit.commitId, path: file.path, row: at },
            usedAt: usesIn(commits.slice(index + 1), name),
          });
        }
      });
    }
  });
  return [...found.values()].filter((each) => each.usedAt.length > 0);
}

function usesIn(commits: TourCommit[], name: string): Site[] {
  const word = new RegExp(`\\b${name}\\b`);
  return commits.flatMap((commit) =>
    commit.files.flatMap((file) =>
      file.rows.flatMap((row, at) =>
        row.kind === "added" && word.test(row.code ?? "")
          ? [{ commitId: commit.commitId, path: file.path, row: at }]
          : [],
      ),
    ),
  );
}

/** One idea relying on another, from the guide or from a name. */
export interface TourLink {
  from: string;
  to: string;
  kind: "guide" | "name";
  /** What the guide says, or the names that make the link. */
  say: string;
}

/** The guide's links between ideas the tour has, and a link from each idea
 *  using a name to the idea that introduced it, one per pair of ideas. */
export function tourLinks(
  commits: TourCommit[],
  guide: Guide | undefined,
  names: Introduced[],
): TourLink[] {
  const ideas = new Set(
    commits.flatMap((commit) => commit.ideas.map((idea) => idea.id)),
  );
  const links: TourLink[] = (guide?.links ?? [])
    .filter((link) => ideas.has(link.from) && ideas.has(link.to))
    .map((link) => ({ ...link, kind: "guide" }));
  const byId = new Map(commits.map((commit) => [commit.commitId, commit]));
  const at = (site: Site) => {
    const commit = byId.get(site.commitId);
    return commit === undefined
      ? undefined
      : ideaAt(commit, site.path, site.row);
  };
  const named = new Map<string, TourLink>();
  for (const each of names) {
    const to = at(each.at);
    if (to === undefined) continue;
    for (const site of each.usedAt) {
      const from = at(site);
      if (from === undefined) continue;
      const key = `${from.id}\n${to.id}`;
      const kept = named.get(key);
      if (kept === undefined) {
        named.set(key, {
          from: from.id,
          to: to.id,
          kind: "name",
          say: each.name,
        });
      } else if (!kept.say.split(", ").includes(each.name)) {
        kept.say = `${kept.say}, ${each.name}`;
      }
    }
  }
  return [...links, ...named.values()];
}

export interface Tour {
  commits: TourCommit[];
  links: TourLink[];
  names: Introduced[];
}

export function buildTour(
  inputs: CommitInput[],
  guide: Guide | undefined,
): Tour {
  const commits = inputs.map((input, index) =>
    tourCommit(
      input,
      index + 1,
      (guide?.ideas ?? []).filter((idea) => idea.commitId === input.commitId),
    ),
  );
  const names = introducedNames(commits);
  return { commits, links: tourLinks(commits, guide, names), names };
}
```

## The tabs

Each kind of series has a tour tab beside its own screen, which stays as it
is, so the reader can fall back to the commit stack for anything the tour
does not do, such as comments and marks. A tour reads the newest version
only, the one the guide is written to.

The controller loads every commit's diff before drawing, since the names a
commit hands on can only be found with all of them, and highlights only the
files on screen.

```tsx
//| id: frontend-screen-tour
//| file: src/frontend/screens/TourScreen.tsx
import { LocalTours, PullTours } from "../controllers/Tours";
import { openLocal, openPull, type Place, tabPlace } from "../model/place";
import type { Visit } from "../state/place";
import { useReviewContext } from "../state/review";
import { ModeTabs } from "../views/ModeTabs";
import { ReviewStrip } from "../views/ReviewStrip";

export function TourScreen({
  place,
  onGo,
}: {
  place: Extract<Place, { tab: "local-tour" | "pull-tour" }>;
  onGo: (place: Place, visit?: Visit) => void;
}) {
  const review = useReviewContext();

  return (
    <div className="app">
      <ModeTabs
        mode={place.tab}
        onSelect={(mode) => {
          if (mode === place.tab) return;
          // The screen of the series a tour reads opens on the same series.
          if (
            mode === "reviews" &&
            place.tab === "local-tour" &&
            place.review !== null
          ) {
            onGo({ tab: "reviews", review: openLocal(place.review.name) });
          } else if (
            mode === "pulls" &&
            place.tab === "pull-tour" &&
            place.pull !== null
          ) {
            onGo({ tab: "pulls", pull: openPull(place.pull.number) });
          } else onGo(tabPlace(mode));
        }}
      />
      <ReviewStrip
        unavailable={review.status === "unavailable" ? review.message : null}
        failure={review.failure}
        onDismiss={review.dismissFailure}
      />
      {place.tab === "local-tour" ? (
        <LocalTours
          place={place.review}
          review={review}
          onGo={(next, visit) =>
            onGo({ tab: "local-tour", review: next }, visit)
          }
        />
      ) : (
        <PullTours
          place={place.pull}
          review={review}
          onGo={(next, visit) => onGo({ tab: "pull-tour", pull: next }, visit)}
        />
      )}
    </div>
  );
}
```

```tsx
//| id: frontend-controller-tours
//| file: src/frontend/controllers/Tours.tsx
import { type ReactNode, useMemo } from "react";
import type { FileDiff } from "../model/diff";
import { guideTo } from "../model/guide";
import { GitOid } from "../model/history";
import type {
  LocalTourPlace,
  PullTourPlace,
  TourFocus,
  TourSpot,
} from "../model/place";
import { localSeries, pullSeries } from "../model/review";
import { rowAsk, type SeriesSource, versionAsk } from "../model/series";
import { buildTour, pathOf, tourFile } from "../model/tour";
import type { Visit } from "../state/place";
import { usePullHistory } from "../state/pullHistory";
import { usePulls } from "../state/pulls";
import type { ReviewHandle } from "../state/review";
import { type RowDiffs, slotKey, useRowDiffs } from "../state/rowDiffs";
import { useSeriesCommits } from "../state/series";
import { useSources } from "../state/source";
import { Message } from "../views/Message";
import { Tour } from "../views/Tour/Tour";
import { TourList } from "../views/TourList";

const NO_FILES: FileDiff[] = [];

export function LocalTours({
  place,
  review,
  onGo,
}: {
  place: LocalTourPlace | null;
  review: ReviewHandle;
  onGo: (place: LocalTourPlace | null, visit?: Visit) => void;
}) {
  if (review.status === "loading") {
    return <Message>Loading local reviews...</Message>;
  }
  const reviews = review.document.localReviews.filter(
    (local) => local.forgottenAt === undefined,
  );
  const open =
    place === null
      ? undefined
      : reviews.find((local) => local.name === place.name);
  if (place === null || open === undefined) {
    return (
      <TourList
        items={reviews.map((local) => ({
          key: local.name,
          title: local.name,
          meta: `v${local.versions.length}, ${local.versions.at(-1)?.revset ?? ""}`,
          guided: review.document.guides.some(
            (guide) =>
              guide.series === localSeries(local.name) &&
              guide.version === String(local.versions.length),
          ),
        }))}
        empty="Nothing is registered for review yet."
        onSelect={(name) => onGo({ name, commit: null, focus: null })}
      />
    );
  }
  const versionId = String(open.versions.length);
  return (
    <TourOf
      key={`${open.name}@${versionId}`}
      source={{ kind: "local", review: open }}
      series={localSeries(open.name)}
      versionId={versionId}
      guides={review.document.guides}
      spot={place}
      onGo={(spot, visit) => onGo({ ...spot, name: open.name }, visit)}
      header={
        <TourHeader
          title={open.name}
          meta={`v${versionId}, ${open.versions.at(-1)?.revset ?? ""}`}
          onBack={() => onGo(null)}
          classic={`/reviews/${encodeURIComponent(open.name)}`}
        />
      }
    />
  );
}

export function PullTours({
  place,
  review,
  onGo,
}: {
  place: PullTourPlace | null;
  review: ReviewHandle;
  onGo: (place: PullTourPlace | null, visit?: Visit) => void;
}) {
  const pulls = usePulls();
  if (pulls.status === "loading") {
    return <Message>Loading pull requests...</Message>;
  }
  if (pulls.status === "error") {
    return <Message tone="error">{pulls.message}</Message>;
  }
  const { repo } = pulls.data;
  if (place === null) {
    return (
      <TourList
        items={pulls.data.pulls.map((pull) => ({
          key: String(pull.number),
          title: `#${pull.number} ${pull.title}`,
          meta: `${pull.state.toLowerCase()}, ${pull.author}`,
          guided: review.document.guides.some(
            (guide) =>
              guide.series === pullSeries(repo, pull.number) &&
              guide.version === pull.headRefOid,
          ),
        }))}
        empty="This repository has no pull requests."
        onSelect={(key) =>
          onGo({ number: Number(key), commit: null, focus: null })
        }
      />
    );
  }
  // The list holds the newest pull requests only, and an older one opened
  // by its address still reads, without the title the list would give it.
  const { number } = place;
  const open = pulls.data.pulls.find((pull) => pull.number === number);
  return (
    <PullTour
      key={number}
      repo={repo}
      number={number}
      header={
        <TourHeader
          title={`#${number} ${open?.title ?? ""}`}
          meta={
            open === undefined
              ? ""
              : `${open.state.toLowerCase()}, ${open.author}`
          }
          onBack={() => onGo(null)}
          classic={`/pulls/${number}`}
        />
      }
      review={review}
      spot={place}
      onGo={(spot, visit) => onGo({ ...spot, number }, visit)}
    />
  );
}

function PullTour({
  repo,
  number,
  header,
  review,
  spot,
  onGo,
}: {
  repo: string;
  number: number;
  header: ReactNode;
  review: ReviewHandle;
  spot: TourSpot;
  onGo: (spot: TourSpot, visit?: Visit) => void;
}) {
  const history = usePullHistory(repo, number);
  if (history.status === "loading") {
    return <Message>Loading versions...</Message>;
  }
  if (history.status === "error") {
    return <Message tone="error">{history.message}</Message>;
  }
  const newest = history.data.states.at(-1);
  if (newest === undefined) {
    return <Message tone="error">This pull request has had no head.</Message>;
  }
  return (
    <TourOf
      key={newest.head}
      source={{ kind: "pull", repo, number }}
      series={pullSeries(repo, number)}
      versionId={newest.head}
      guides={review.document.guides}
      spot={spot}
      onGo={onGo}
      header={header}
    />
  );
}

function TourHeader({
  title,
  meta,
  onBack,
  classic,
}: {
  title: string;
  meta: string;
  onBack: () => void;
  classic: string;
}) {
  return (
    <div className="tour-title">
      <button type="button" className="tour-link" onClick={onBack}>
        all
      </button>
      <strong className="tour-title__name">{title}</strong>
      <span className="tour-title__meta">{meta}</span>
      <a className="tour-link" href={classic}>
        classic view
      </a>
    </div>
  );
}

function filesOf(diffs: RowDiffs, id: string | null | undefined): FileDiff[] {
  const found =
    id == null ? undefined : diffs.get(slotKey({ left: null, right: id }));
  return found?.status === "ready" ? found.data : NO_FILES;
}

/** The commit an idea of the guide, or a file the guide left out, is in. */
function commitOfIdea(
  guide: ReturnType<typeof guideTo>,
  id: string,
): string | undefined {
  return (
    guide?.ideas.find((idea) => idea.id === id)?.commitId ?? id.split(":")[0]
  );
}

/** The newest version of one series, read as a tour. */
function TourOf({
  source,
  series,
  versionId,
  guides,
  spot,
  onGo,
  header,
}: {
  source: SeriesSource;
  series: string;
  versionId: string;
  guides: ReviewHandle["document"]["guides"];
  spot: TourSpot;
  onGo: (spot: TourSpot, visit?: Visit) => void;
  header: ReactNode;
}) {
  const ask = useMemo(() => versionAsk(source, versionId), [source, versionId]);
  const commits = useSeriesCommits(ask);
  const slots = useMemo(
    () =>
      commits.status === "ready"
        ? commits.data.map((commit) => ({ left: null, right: commit.commitId }))
        : [],
    [commits],
  );
  const diffs = useRowDiffs(rowAsk(source, { kind: "base" }, versionId), slots);
  const guide = guideTo(guides, series, versionId);

  const list = commits.status === "ready" ? commits.data : [];
  const commitId = spot.commit ?? list[0]?.commitId ?? null;
  const pairedId =
    spot.focus?.kind === "link"
      ? commitOfIdea(guide, spot.focus.to)
      : undefined;
  const wanted = useMemo(
    () => [
      ...filesOf(diffs, commitId),
      ...(pairedId === commitId ? [] : filesOf(diffs, pairedId)),
    ],
    [diffs, commitId, pairedId],
  );
  const lookup = useSources(wanted);

  const loaded = list.map((commit) =>
    diffs.get(slotKey({ left: null, right: commit.commitId })),
  );
  const failed = loaded.find((state) => state?.status === "error");
  const ready =
    commits.status === "ready" &&
    loaded.every((state) => state?.status === "ready");

  const tour = useMemo(() => {
    if (!ready) return null;
    return buildTour(
      list.map((commit) => ({
        commitId: commit.commitId,
        description: commit.description,
        files: filesOf(diffs, commit.commitId).map((file) => {
          const blob = file.newBlob;
          const length =
            blob === null
              ? null
              : (lookup(blob, pathOf(file))?.lines.length ?? null);
          return tourFile(file, length);
        }),
      })),
      guide,
    );
  }, [ready, diffs, lookup, guide, list]);

  if (commits.status === "loading")
    return <Message>Loading commits...</Message>;
  if (commits.status === "error") {
    return <Message tone="error">{commits.message}</Message>;
  }
  if (failed?.status === "error") {
    return <Message tone="error">{failed.message}</Message>;
  }
  if (tour === null || commitId === null) {
    return <Message>Loading {list.length} commits...</Message>;
  }
  return (
    <Tour
      tour={tour}
      commitId={commitId}
      focus={spot.focus}
      onGo={(commit: string, focus: TourFocus | null) =>
        onGo({ commit: GitOid.parse(commit), focus })
      }
      source={lookup}
      header={header}
      guidedBy={
        guide === undefined
          ? null
          : `Guide by ${guide.author}, ${guide.writtenAt.slice(0, 10)}`
      }
    />
  );
}
```

```tsx
//| id: frontend-view-tour-list
//| file: src/frontend/views/TourList.tsx
export interface TourListItem {
  key: string;
  title: string;
  meta: string;
  /** Whether its newest version has a guide. */
  guided: boolean;
}

export function TourList({
  items,
  empty,
  onSelect,
}: {
  items: TourListItem[];
  empty: string;
  onSelect: (key: string) => void;
}) {
  if (items.length === 0) return <p className="message">{empty}</p>;
  return (
    <ul className="tour-list">
      {items.map((item) => (
        <li key={item.key}>
          <button
            type="button"
            className="tour-list__item"
            onClick={() => onSelect(item.key)}
          >
            <span className="tour-list__title">{item.title}</span>
            <span className="tour-list__meta">
              {item.meta}
              {item.guided && <span className="tour-list__guided">guided</span>}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
```

## The tour view

Three columns: the map of every idea, the current commit's cards, and a
drawer with the whole file of the card being read. The card being read is
the one across a line a third of the way down the cards, where the eye sits
while scrolling.

What the map narrowed to lives in the [address](address.md), so back undoes a
jump across commits. Narrowing to a link reads the idea that relies on
another with the other in the drawer, so the reader sees a setup and its
payoff side by side, rather than holding one in mind across a commit switch.

```tsx
//| id: frontend-view-tour
//| file: src/frontend/views/Tour/Tour.tsx
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { TourFocus } from "../../model/place";
import type { SourceLookup } from "../../model/source";
import {
  fileOrder,
  type Introduced,
  type Span,
  type TourCard,
  type TourCommit,
  type TourIdea,
  type TourLink,
  type Tour as TourModel,
} from "../../model/tour";
import { CardView, type NameLinks } from "./CardView";
import { IdeaMap } from "./IdeaMap";
import { Peek } from "./Peek";

/** What the reader has asked of the tour that the address does not keep. */
type Order = "story" | "file";

/** A card the reader is taken to once its commit is on screen. */
interface Aim {
  card: string;
  row: number | null;
}

export interface TourProps {
  tour: TourModel;
  /** The commit on screen, which the address names. */
  commitId: string;
  focus: TourFocus | null;
  onGo: (commitId: string, focus: TourFocus | null) => void;
  source: SourceLookup;
  header: ReactNode;
  /** Who wrote the guide and when, or null for a series with none. */
  guidedBy: string | null;
}

/** The ideas a link joins, read from the tour. */
function ideaIndex(tour: TourModel) {
  const ideas = new Map<string, { idea: TourIdea; commit: TourCommit }>();
  for (const commit of tour.commits) {
    for (const idea of commit.ideas) ideas.set(idea.id, { idea, commit });
  }
  return ideas;
}

export function Tour({
  tour,
  commitId,
  focus,
  onGo,
  source,
  header,
  guidedBy,
}: TourProps) {
  const ideas = useMemo(() => ideaIndex(tour), [tour]);
  const commit =
    tour.commits.find((each) => each.commitId === commitId) ?? tour.commits[0];
  const [order, setOrder] = useState<Order>("story");
  const [drawer, setDrawer] = useState(true);
  const [opened, setOpened] = useState<ReadonlyMap<string, Span[]>>(new Map());
  const [current, setCurrent] = useState<string | null>(null);
  const [aim, setAim] = useState<Aim | null>(null);
  const cardsRef = useRef<HTMLDivElement>(null);

  const pair =
    focus?.kind === "link"
      ? { from: ideas.get(focus.from), to: ideas.get(focus.to) }
      : null;
  const narrowed =
    focus?.kind === "idea"
      ? ideas.get(focus.id)?.idea
      : focus?.kind === "link"
        ? pair?.from?.idea
        : undefined;

  const shown: TourIdea[] =
    commit === undefined
      ? []
      : narrowed !== undefined
        ? [narrowed]
        : commit.ideas;
  const cards: TourCard[] =
    commit === undefined
      ? []
      : order === "file" && narrowed === undefined
        ? fileOrder(commit)
        : shown.flatMap((idea) => idea.cards);
  const currentCard =
    cards.find((card) => card.key === current) ?? cards[0] ?? null;
  const currentIdea =
    currentCard === null ? undefined : ideas.get(currentCard.ideaId)?.idea;

  // The reading line sits a third of the way down, where the eye rests
  // while scrolling, and the card across it is the one being read.
  useEffect(() => {
    const scroller = cardsRef.current;
    if (scroller === null) return;
    let frame = 0;
    const read = () => {
      frame = 0;
      const line =
        scroller.getBoundingClientRect().top + scroller.clientHeight / 3;
      let found: string | null = null;
      for (const element of scroller.querySelectorAll<HTMLElement>(
        "[data-card]",
      )) {
        const box = element.getBoundingClientRect();
        if (box.top <= line) found = element.dataset.card ?? null;
        if (box.bottom >= line) break;
      }
      if (found !== null) setCurrent(found);
    };
    const onScroll = () => {
      if (frame === 0) frame = requestAnimationFrame(read);
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    read();
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);

  // A new commit or a new narrowing starts at the top, unless something
  // asked to be taken to a card in it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scrolls only when what is read changes
  useEffect(() => {
    const scroller = cardsRef.current;
    if (scroller === null) return;
    if (aim === null) {
      scroller.scrollTop = 0;
      return;
    }
    const card = scroller.querySelector<HTMLElement>(
      `[data-card="${CSS.escape(aim.card)}"]`,
    );
    const row =
      aim.row === null
        ? null
        : card?.querySelector<HTMLElement>(`[data-row="${aim.row}"]`);
    const target = row ?? card;
    if (target != null) {
      target.scrollIntoView({ block: "center" });
      target.classList.add("tour-flash");
      setTimeout(() => target.classList.remove("tour-flash"), 1200);
      setCurrent(aim.card);
    }
    setAim(null);
  }, [commit?.commitId, JSON.stringify(focus), order]);

  const goToIdea = (id: string) => {
    const found = ideas.get(id);
    if (found === undefined) return;
    onGo(found.commit.commitId, { kind: "idea", id });
  };

  const setupNames = useMemo(
    () => nameLinks(tour, pair?.to?.commit),
    [tour, pair?.to?.commit],
  );
  const names: NameLinks = useMemo(
    () => nameLinks(tour, commit),
    [tour, commit],
  );

  const goToName = (name: Introduced) => {
    const target = tour.commits.find(
      (each) => each.commitId === name.at.commitId,
    );
    const card = target?.ideas
      .flatMap((idea) => idea.cards)
      .find(
        (each) =>
          each.kind === "file" &&
          each.path === name.at.path &&
          each.spans.some(([a, b]) => a <= name.at.row && name.at.row <= b),
      );
    if (target === undefined || card === undefined) return;
    setAim({ card: card.key, row: name.at.row });
    onGo(target.commitId, null);
  };

  const step = (by: number) => {
    const at = cards.findIndex((card) => card.key === currentCard?.key);
    const next = cards[Math.max(0, Math.min(cards.length - 1, at + by))];
    if (next === undefined) return;
    cardsRef.current
      ?.querySelector(`[data-card="${CSS.escape(next.key)}"]`)
      ?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  // Rebinds each render, so a key reads the state it was pressed in.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable]")) return;
      const digit = Number(event.key);
      if (digit >= 1 && digit <= tour.commits.length) {
        const chosen = tour.commits[digit - 1];
        if (chosen !== undefined) onGo(chosen.commitId, null);
      } else if (event.key === "n" || event.key === "j") step(1);
      else if (event.key === "p" || event.key === "k") step(-1);
      else if (event.key === "o")
        setOrder(order === "story" ? "file" : "story");
      else if (event.key === " ") setDrawer(!drawer);
      else if (event.key === "Escape" && focus !== null && commit !== undefined)
        onGo(commit.commitId, null);
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (commit === undefined) {
    return <p className="message">This version has no commits.</p>;
  }

  const open = (key: string, span: Span) =>
    setOpened((now) => new Map(now).set(key, [...(now.get(key) ?? []), span]));

  const card = (each: TourCard, idea: TourIdea | undefined, label: boolean) => (
    <CardView
      key={each.key}
      card={each}
      commit={commit}
      idea={label ? idea : undefined}
      current={each.key === currentCard?.key}
      opened={opened.get(each.key) ?? []}
      onOpen={(span) => open(each.key, span)}
      source={source}
      names={names}
      onName={goToName}
    />
  );

  // A message card shows the message itself, so the drawer looks ahead to
  // the next file the commit reads.
  const peekCard =
    pair?.to !== undefined
      ? null
      : (cards
          .slice(Math.max(0, cards.indexOf(currentCard as TourCard)))
          .find((each) => each.kind === "file") ?? null);

  return (
    <div
      className={[
        "tour",
        drawer ? "tour--drawer" : "",
        pair !== null ? "tour--pair" : "",
      ].join(" ")}
    >
      <header className="tour__head">
        {header}
        <nav className="tour__commits" aria-label="commits">
          {tour.commits.map((each) => (
            <button
              type="button"
              key={each.commitId}
              className={
                each.commitId === commit.commitId
                  ? "tour-commit tour-commit--current"
                  : "tour-commit"
              }
              aria-current={each.commitId === commit.commitId}
              onClick={() => onGo(each.commitId, null)}
              title={each.subject}
            >
              <span className="tour-pill">{each.number}</span>
              <span className="tour-commit__subject">{each.subject}</span>
            </button>
          ))}
        </nav>
        <div className="tour__tools">
          <span className="tour__guided">
            {guidedBy ?? "No guide yet: each file reads as its own idea"}
          </span>
          <button
            type="button"
            className="tour-toggle"
            aria-pressed={order === "file"}
            onClick={() => setOrder(order === "story" ? "file" : "story")}
            title="o"
          >
            {order === "story" ? "story order" : "file order"}
          </button>
          <button
            type="button"
            className="tour-toggle tour-toggle--drawer"
            aria-pressed={drawer}
            onClick={() => setDrawer(!drawer)}
            title="space"
          >
            whole file
          </button>
        </div>
      </header>
      <aside className="tour__map">
        <IdeaMap
          tour={tour}
          commitId={commit.commitId}
          currentIdea={currentIdea?.id ?? null}
          focus={focus}
          onCommit={(id) => onGo(id, null)}
          onIdea={goToIdea}
          onLink={(link) => {
            const from = ideas.get(link.from);
            if (from !== undefined) {
              onGo(from.commit.commitId, {
                kind: "link",
                from: link.from,
                to: link.to,
              });
            }
          }}
        />
      </aside>
      <main className="tour__cards" ref={cardsRef}>
        {focus !== null && (
          <Narrowed
            focus={focus}
            ideas={ideas}
            links={tour.links}
            onClear={() => onGo(commit.commitId, null)}
          />
        )}
        {order === "file" && narrowed === undefined ? (
          <section className="tour-idea">
            <h2 className="tour-idea__title">
              <span className="tour-pill">{commit.number}</span>
              {commit.subject}
            </h2>
            {cards.map((each) =>
              card(each, ideas.get(each.ideaId)?.idea, true),
            )}
          </section>
        ) : (
          shown.map((idea) => (
            <IdeaSection
              key={idea.id}
              idea={idea}
              commit={commit}
              ideas={ideas}
              links={tour.links}
              names={tour.names}
              onIdea={goToIdea}
            >
              {idea.cards.map((each) => card(each, idea, false))}
            </IdeaSection>
          ))
        )}
        <p className="tour__end">
          End of commit {commit.number}.{" "}
          {tour.commits[commit.number] !== undefined && (
            <button
              type="button"
              className="tour-link"
              onClick={() => {
                const next = tour.commits[commit.number];
                if (next !== undefined) onGo(next.commitId, null);
              }}
            >
              On to commit {commit.number + 1}
            </button>
          )}
        </p>
      </main>
      <aside className="tour__drawer">
        {pair?.to !== undefined ? (
          <div className="tour-setup">
            <p className="tour-setup__label">
              Set up in commit {pair.to.commit.number}
            </p>
            <IdeaSection
              idea={pair.to.idea}
              commit={pair.to.commit}
              ideas={ideas}
              links={tour.links}
              names={tour.names}
              onIdea={goToIdea}
            >
              {pair.to.idea.cards.map((each) => (
                <CardView
                  key={each.key}
                  card={each}
                  commit={pair.to?.commit ?? commit}
                  current={false}
                  opened={opened.get(each.key) ?? []}
                  onOpen={(span) => open(each.key, span)}
                  source={source}
                  names={setupNames}
                  onName={goToName}
                />
              ))}
            </IdeaSection>
          </div>
        ) : peekCard !== null ? (
          <Peek
            commit={commit}
            card={peekCard}
            opened={opened.get(peekCard.key) ?? []}
            onPull={(span) => open(peekCard.key, span)}
            source={source}
          />
        ) : (
          <div className="tour-message tour-message--whole">
            <p className="tour-setup__label">Commit {commit.number}</p>
            <pre>{commit.description}</pre>
          </div>
        )}
      </aside>
    </div>
  );
}

/** Where each name an earlier commit introduced is used in `commit`, and
 *  the names `commit` itself introduces. */
function nameLinks(tour: TourModel, commit: TourCommit | undefined): NameLinks {
  const earlier = new Set(
    tour.commits
      .filter((each) => commit !== undefined && each.number < commit.number)
      .map((each) => each.commitId),
  );
  const numbers = new Map(
    tour.commits.map((each) => [each.commitId, each.number]),
  );
  const usable = tour.names.filter((name) => earlier.has(name.at.commitId));
  return {
    pattern:
      usable.length === 0
        ? null
        : new RegExp(
            `\\b(${usable.map((name) => name.name).join("|")})\\b`,
            "g",
          ),
    byName: new Map(usable.map((name) => [name.name, name])),
    commitNumber: (id) => numbers.get(id) ?? 0,
    preview: (name) => {
      const at = tour.commits.find(
        (each) => each.commitId === name.at.commitId,
      );
      const file = at?.files.find((each) => each.path === name.at.path);
      if (at === undefined || file === undefined) return null;
      return { commit: at, file, row: name.at.row };
    },
  };
}

function IdeaSection({
  idea,
  commit,
  ideas,
  links,
  names,
  onIdea,
  children,
}: {
  idea: TourIdea;
  commit: TourCommit;
  ideas: Map<string, { idea: TourIdea; commit: TourCommit }>;
  links: TourLink[];
  names: Introduced[];
  onIdea: (id: string) => void;
  children: ReactNode;
}) {
  const out = links.filter((link) => link.from === idea.id);
  const into = links.filter((link) => link.to === idea.id);
  const ref = (id: string, say: string, kind: TourLink["kind"]) => {
    const found = ideas.get(id);
    if (found === undefined) return null;
    return (
      <li key={`${id}:${kind}`}>
        <button
          type="button"
          className={`tour-wiki tour-wiki--${kind}`}
          onClick={() => onIdea(id)}
        >
          <span className="tour-pill">{found.commit.number}</span>
          {found.idea.title}
        </button>{" "}
        <span className="tour-wiki__say">
          {kind === "name" ? `uses ${say}` : say}
        </span>
      </li>
    );
  };
  const introduced = names.filter(
    (name) =>
      name.at.commitId === commit.commitId &&
      idea.cards.some(
        (card) =>
          card.kind === "file" &&
          card.path === name.at.path &&
          card.spans.some(([a, b]) => a <= name.at.row && name.at.row <= b),
      ),
  );
  return (
    <section
      className={idea.guided ? "tour-idea" : "tour-idea tour-idea--rest"}
      data-idea={idea.id}
    >
      <h2 className="tour-idea__title">
        <span className="tour-pill">{commit.number}</span>
        {idea.title}
        {!idea.guided && (
          <span className="tour-idea__aside">not in the guide</span>
        )}
      </h2>
      {idea.note !== "" && <p className="tour-idea__note">{idea.note}</p>}
      {out.length > 0 && (
        <div className="tour-links">
          <span className="tour-links__label">Relies on</span>
          <ul>{out.map((link) => ref(link.to, link.say, link.kind))}</ul>
        </div>
      )}
      {children}
      {(into.length > 0 || introduced.length > 0) && (
        <footer className="tour-backlinks">
          {into.filter((link) => link.kind === "guide").length > 0 && (
            <div className="tour-links">
              <span className="tour-links__label">Linked from</span>
              <ul>
                {into
                  .filter((link) => link.kind === "guide")
                  .map((link) => ref(link.from, link.say, link.kind))}
              </ul>
            </div>
          )}
          {into.filter((link) => link.kind === "name").length > 0 && (
            <div className="tour-links">
              <span className="tour-links__label">Names used in</span>
              <ul>
                {into
                  .filter((link) => link.kind === "name")
                  .map((link) => ref(link.from, link.say, link.kind))}
              </ul>
            </div>
          )}
        </footer>
      )}
    </section>
  );
}

function Narrowed({
  focus,
  ideas,
  links,
  onClear,
}: {
  focus: TourFocus;
  ideas: Map<string, { idea: TourIdea; commit: TourCommit }>;
  links: TourLink[];
  onClear: () => void;
}) {
  const name = (id: string) => {
    const found = ideas.get(id);
    return found === undefined ? (
      id
    ) : (
      <>
        <span className="tour-pill">{found.commit.number}</span>
        {found.idea.title}
      </>
    );
  };
  const says =
    focus.kind === "link"
      ? links
          .filter((link) => link.from === focus.from && link.to === focus.to)
          .map((link) => (link.kind === "name" ? `uses ${link.say}` : link.say))
      : [];
  return (
    <div className="tour-narrowed">
      {focus.kind === "idea" ? (
        <span>Narrowed to {name(focus.id)}</span>
      ) : (
        <span>
          {name(focus.from)} relies on {name(focus.to)}
          {says.length > 0 && (
            <span className="tour-narrowed__say">: {says.join("; ")}</span>
          )}
        </span>
      )}
      <button type="button" className="tour-link" onClick={onClear}>
        whole commit
      </button>
    </div>
  );
}
```

### Cards

A name an earlier commit introduced is a link in the code, which previews
where it was defined on hover and goes there on a click.

```tsx
//| id: frontend-view-tour-card
//| file: src/frontend/views/Tour/CardView.tsx
import { type ReactNode, useState } from "react";
import type { SourceLookup, SyntaxToken } from "../../model/source";
import type {
  FileRow,
  Introduced,
  Span,
  TourCard,
  TourCommit,
  TourFile,
  TourIdea,
} from "../../model/tour";

/** The names a commit's code links to the commit that introduced them. */
export interface NameLinks {
  /** Matches any of them as a whole word, or null when there are none. */
  pattern: RegExp | null;
  byName: Map<string, Introduced>;
  commitNumber: (commitId: string) => number;
  preview: (
    name: Introduced,
  ) => { commit: TourCommit; file: TourFile; row: number } | null;
}

/** Rows drawn around what a card is about, so it reads in context. */
const AROUND = 3;
/** Rows one press of a fold's arrow shows. */
const STEP = 20;

/** `spans`, each widened by `by` and clipped to `length` rows, merged where
 *  they meet. */
export function visible(spans: Span[], by: number, length: number): Span[] {
  const sorted = spans
    .map(([a, b]): Span => [Math.max(0, a - by), Math.min(length - 1, b + by)])
    .sort((x, y) => x[0] - y[0]);
  const merged: [number, number][] = [];
  for (const [a, b] of sorted) {
    const last = merged.at(-1);
    if (last !== undefined && a <= last[1] + 1) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }
  return merged;
}

/** The tokens of one row, from the file each side is read from, or the
 *  patch's plain text while the file has not loaded. */
export function rowTokens(
  file: TourFile,
  row: FileRow,
  source: SourceLookup,
): SyntaxToken[] {
  const oldSide = row.kind === "removed";
  const blob = oldSide ? file.diff.oldBlob : file.diff.newBlob;
  const line = oldSide ? row.old : row.new;
  const lines =
    blob === null
      ? undefined
      : source(blob, oldSide ? file.oldPath : file.path)?.lines;
  const found = line === null ? undefined : lines?.[line - 1];
  return found ?? [{ text: row.code ?? "", kind: null }];
}

export function CodeRow({
  file,
  index,
  source,
  names,
  onName,
  className = "",
  onClick,
}: {
  file: TourFile;
  index: number;
  source: SourceLookup;
  names: NameLinks | null;
  onName: ((name: Introduced) => void) | null;
  className?: string;
  onClick?: () => void;
}) {
  const row = file.rows[index];
  if (row === undefined) return null;
  const sign = row.kind === "added" ? "+" : row.kind === "removed" ? "-" : "";
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a row is clicked with the mouse; the keyboard reads the card instead
    // biome-ignore lint/a11y/useKeyWithClickEvents: as above
    <div
      className={`tour-row tour-row--${row.kind} ${className}`}
      data-row={index}
      onClick={onClick}
    >
      <span className="tour-row__no">{row.old}</span>
      <span className="tour-row__no">{row.new}</span>
      <span className="tour-row__sign">{sign}</span>
      <code className="tour-row__code">
        {rowTokens(file, row, source).map((token, at) => (
          <Token
            // biome-ignore lint/suspicious/noArrayIndexKey: tokens of one line never move
            key={at}
            token={token}
            names={row.kind === "removed" ? null : names}
            onName={onName}
          />
        ))}
      </code>
    </div>
  );
}

function Token({
  token,
  names,
  onName,
}: {
  token: SyntaxToken;
  names: NameLinks | null;
  onName: ((name: Introduced) => void) | null;
}) {
  const className = token.kind === null ? undefined : `syntax--${token.kind}`;
  if (names?.pattern == null || onName === null) {
    return <span className={className}>{token.text}</span>;
  }
  const parts: ReactNode[] = [];
  let at = 0;
  for (const match of token.text.matchAll(names.pattern)) {
    const name = names.byName.get(match[0]);
    if (name === undefined || match.index === undefined) continue;
    parts.push(token.text.slice(at, match.index));
    parts.push(
      <NameLink key={match.index} name={name} names={names} onName={onName} />,
    );
    at = match.index + match[0].length;
  }
  if (parts.length === 0)
    return <span className={className}>{token.text}</span>;
  parts.push(token.text.slice(at));
  return <span className={className}>{parts}</span>;
}

function NameLink({
  name,
  names,
  onName,
}: {
  name: Introduced;
  names: NameLinks;
  onName: (name: Introduced) => void;
}) {
  const [peek, setPeek] = useState<DOMRect | null>(null);
  const preview = peek === null ? null : names.preview(name);
  const number = names.commitNumber(name.at.commitId);
  return (
    <button
      type="button"
      className="tour-name"
      onMouseEnter={(event) =>
        setPeek(event.currentTarget.getBoundingClientRect())
      }
      onMouseLeave={() => setPeek(null)}
      onFocus={(event) => setPeek(event.currentTarget.getBoundingClientRect())}
      onBlur={() => setPeek(null)}
      onClick={() => onName(name)}
    >
      {name.name}
      <sup className="tour-name__commit">{number}</sup>
      {peek !== null && preview !== null && (
        <span
          className="tour-pop"
          style={{
            left: Math.min(peek.left, window.innerWidth - 480),
            top:
              peek.bottom + 6 + 220 > window.innerHeight
                ? peek.top - 226
                : peek.bottom + 6,
          }}
        >
          <span className="tour-pop__head">
            <span className="tour-pill">{number}</span> introduced in{" "}
            {preview.file.path}
          </span>
          {preview.file.rows
            .slice(Math.max(0, preview.row - 2), preview.row + 6)
            .map((row, at) => {
              const index = Math.max(0, preview.row - 2) + at;
              return (
                <span
                  key={index}
                  className={`tour-row tour-row--${row.kind} ${index === preview.row ? "tour-row--aim" : ""}`}
                >
                  <span className="tour-row__no">{row.new ?? row.old}</span>
                  <code className="tour-row__code">{row.code ?? ""}</code>
                </span>
              );
            })}
          <span className="tour-pop__foot">
            used in {name.usedAt.length} places
          </span>
        </span>
      )}
    </button>
  );
}

function Fold({
  hidden,
  edge,
  onOpen,
}: {
  hidden: Span;
  /** Whether the fold runs to the top or the bottom of the file. */
  edge: "top" | "bottom" | null;
  onOpen: (span: Span) => void;
}) {
  const [a, b] = hidden;
  const count = b - a + 1;
  const button = (span: Span, label: string) => (
    <button
      type="button"
      className="tour-fold__button"
      onClick={() => onOpen(span)}
    >
      {label}
    </button>
  );
  return (
    <div className="tour-fold">
      <span>
        {count} unchanged {count === 1 ? "line" : "lines"}
        {edge === "top" ? " above" : edge === "bottom" ? " below" : ""}
      </span>
      {count <= STEP + 5 ? (
        button(hidden, "show")
      ) : (
        <>
          {edge !== "top" && button([a, a + STEP - 1], `${STEP} more down`)}
          {edge !== "bottom" && button([b - STEP + 1, b], `${STEP} more up`)}
          {button(hidden, "all")}
        </>
      )}
    </div>
  );
}

/** The commit's first card on its message, which opens the message; the
 *  others leave it folded, having said what to read in it. */
function firstMessage(commit: TourCommit): string | undefined {
  return commit.ideas
    .flatMap((idea) => idea.cards)
    .find((card) => card.kind === "message")?.key;
}

/** One card: the rows a stop is about with a few around, folds for the rest,
 *  and the guide's note; or the commit's message. */
export function CardView({
  card,
  commit,
  idea,
  current,
  opened,
  onOpen,
  source,
  names,
  onName,
}: {
  card: TourCard;
  commit: TourCommit;
  /** The idea to name on the card, in file order where it is not the
   *  heading above. */
  idea?: TourIdea | undefined;
  current: boolean;
  opened: Span[];
  onOpen: (span: Span) => void;
  source: SourceLookup;
  names: NameLinks;
  onName: (name: Introduced) => void;
}) {
  const className = `tour-card ${current ? "tour-card--current" : ""}`;
  const label = idea !== undefined && (
    <span className="tour-card__idea">{idea.title}</span>
  );
  const note = card.note !== "" && (
    <p className="tour-card__note">{card.note}</p>
  );

  if (card.kind === "message") {
    return (
      <article className={className} data-card={card.key}>
        <div className="tour-card__head">
          <span className="tour-card__path">commit message</span>
          {label}
        </div>
        {note}
        <details
          className="tour-message"
          open={firstMessage(commit) === card.key}
        >
          <summary>{commit.subject}</summary>
          <pre>{commit.description.slice(commit.subject.length).trim()}</pre>
        </details>
      </article>
    );
  }

  const file = commit.files.find((each) => each.path === card.path);
  if (file === undefined) return null;
  const length = file.rows.length;
  const shown = visible([...card.spans, ...opened], AROUND, length);
  const own = (index: number) =>
    card.spans.some(([a, b]) => a <= index && index <= b);
  const body: ReactNode[] = [];
  let next = 0;
  for (const [a, b] of shown) {
    if (a > next) {
      body.push(
        <Fold
          key={`fold-${next}`}
          hidden={[next, a - 1]}
          edge={next === 0 ? "top" : null}
          onOpen={onOpen}
        />,
      );
    }
    for (let index = a; index <= b; index++) {
      body.push(
        <CodeRow
          key={index}
          file={file}
          index={index}
          source={source}
          names={names}
          onName={onName}
          className={own(index) ? "tour-row--own" : ""}
        />,
      );
    }
    next = b + 1;
  }
  if (next < length) {
    body.push(
      <Fold
        key={`fold-${next}`}
        hidden={[next, length - 1]}
        edge="bottom"
        onOpen={onOpen}
      />,
    );
  }
  const first = file.rows[card.spans[0]?.[0] ?? 0];
  return (
    <article className={className} data-card={card.key}>
      <div className="tour-card__head">
        <span className="tour-card__path">{file.path}</span>
        <span className="tour-card__lines">
          {first?.new !== null && first?.new !== undefined
            ? `line ${first.new}`
            : ""}
        </span>
        {label}
      </div>
      {note}
      <div className="tour-card__code">{body}</div>
    </article>
  );
}
```

### The whole file

The drawer is how a card gets more context than its folds give: a click on
any row of the file widens the card to reach it.

```tsx
//| id: frontend-view-tour-peek
//| file: src/frontend/views/Tour/Peek.tsx
import { useEffect, useRef } from "react";
import type { SourceLookup } from "../../model/source";
import type { Span, TourCard, TourCommit } from "../../model/tour";
import { CodeRow, visible } from "./CardView";

/** The whole file the current card is in, with the card's rows marked. A
 *  click on any other row widens the card to reach it. */
export function Peek({
  commit,
  card,
  opened,
  onPull,
  source,
}: {
  commit: TourCommit;
  card: Extract<TourCard, { kind: "file" }>;
  opened: Span[];
  onPull: (span: Span) => void;
  source: SourceLookup;
}) {
  const file = commit.files.find((each) => each.path === card.path);
  const ref = useRef<HTMLDivElement>(null);
  const shown =
    file === undefined
      ? []
      : visible([...card.spans, ...opened], 3, file.rows.length);
  const first = shown[0]?.[0] ?? 0;

  // biome-ignore lint/correctness/useExhaustiveDependencies: follows the card, not each widening of it
  useEffect(() => {
    ref.current
      ?.querySelector(`[data-row="${first}"]`)
      ?.scrollIntoView({ block: "center" });
  }, [card.key, file]);

  if (file === undefined) return null;
  const inCard = (index: number) =>
    shown.some(([a, b]) => a <= index && index <= b);
  const pull = (index: number) => {
    const before = shown.filter(([a]) => a <= index).at(-1);
    const after = shown.find(([a]) => a > index);
    if (
      before !== undefined &&
      (after === undefined || index - before[1] <= after[0] - index)
    ) {
      onPull([before[1], index]);
    } else if (after !== undefined) {
      onPull([index, after[0]]);
    }
  };

  return (
    <div className="tour-peek">
      <p className="tour-setup__label">
        {file.path}, {file.rows.length} rows. Click a row to bring it into the
        card.
      </p>
      <div className="tour-peek__rows" ref={ref}>
        {file.rows.map((_row, index) => (
          <CodeRow
            // biome-ignore lint/suspicious/noArrayIndexKey: a file's rows never move
            key={index}
            file={file}
            index={index}
            source={source}
            names={null}
            onName={null}
            className={
              inCard(index) ? "tour-row--in-card" : "tour-row--pullable"
            }
            onClick={inCard(index) ? undefined : () => pull(index)}
          />
        ))}
      </div>
    </div>
  );
}
```

### The map

Every commit's ideas in one column, with the links between them as arcs in
a gutter. A graph laid out in commit columns was the other candidate, but a
sidebar is too narrow for three columns of titles, and one column keeps each
title readable while the arcs still show what connects to what. A click on
an idea narrows the cards to it; a click on an arc narrows to the pair it
joins.

```tsx
//| id: frontend-view-idea-map
//| file: src/frontend/views/Tour/IdeaMap.tsx
import { useState } from "react";
import type { TourFocus } from "../../model/place";
import type { Tour, TourLink } from "../../model/tour";

const ROW = 24;
const HEAD = 30;
const GUTTER = 64;

interface Placed {
  id: string;
  commitId: string;
  y: number;
}

/** Every commit's ideas in one column, a commit's under its heading, with an
 *  arc in the gutter for each link between two of them. */
export function IdeaMap({
  tour,
  commitId,
  currentIdea,
  focus,
  onCommit,
  onIdea,
  onLink,
}: {
  tour: Tour;
  commitId: string;
  currentIdea: string | null;
  focus: TourFocus | null;
  onCommit: (commitId: string) => void;
  onIdea: (id: string) => void;
  onLink: (link: TourLink) => void;
}) {
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(new Set());
  const placed = new Map<string, Placed>();
  const heads: {
    commitId: string;
    number: number;
    subject: string;
    y: number;
  }[] = [];
  const folds: { commitId: string; count: number; y: number }[] = [];
  const shown = new Set<string>();
  let y = 0;
  for (const commit of tour.commits) {
    heads.push({
      commitId: commit.commitId,
      number: commit.number,
      subject: commit.subject,
      y,
    });
    y += HEAD;
    // A guided commit folds the files its guide leaves out into one row,
    // where their arcs meet.
    const guided = commit.ideas.some((idea) => idea.guided);
    const folded = guided && !unfolded.has(commit.commitId);
    const rest = commit.ideas.filter((idea) => !idea.guided);
    for (const idea of commit.ideas) {
      if (folded && !idea.guided) continue;
      placed.set(idea.id, {
        id: idea.id,
        commitId: commit.commitId,
        y: y + ROW / 2,
      });
      shown.add(idea.id);
      y += ROW;
    }
    if (guided && rest.length > 0) {
      folds.push({ commitId: commit.commitId, count: rest.length, y });
      for (const idea of folded ? rest : []) {
        placed.set(idea.id, {
          id: idea.id,
          commitId: commit.commitId,
          y: y + ROW / 2,
        });
      }
      y += ROW;
    }
  }
  const height = y + 4;
  const biggest = Math.max(
    1,
    ...tour.commits.flatMap((commit) => commit.ideas.map((idea) => idea.size)),
  );

  const lit = focus?.kind === "idea" ? focus.id : currentIdea;
  const near = new Set(
    tour.links
      .filter((link) => link.from === lit || link.to === lit)
      .flatMap((link) => [link.from, link.to]),
  );
  // One arc per pair of ideas, however many links join them.
  const arcs = new Map<string, TourLink[]>();
  for (const link of tour.links) {
    const key = `${link.from}\n${link.to}`;
    arcs.set(key, [...(arcs.get(key) ?? []), link]);
  }

  return (
    <div className="idea-map">
      <svg
        className="idea-map__arcs"
        width={GUTTER}
        height={height}
        role="img"
        aria-label="links between ideas"
      >
        {[...arcs.values()].map((links) => {
          const [link] = links;
          if (link === undefined) return null;
          const from = placed.get(link.from);
          const to = placed.get(link.to);
          if (from === undefined || to === undefined) return null;
          const reach = Math.min(
            GUTTER - 6,
            10 + Math.abs(from.y - to.y) * 0.22,
          );
          const x = GUTTER - 2;
          const path = `M ${x} ${from.y} C ${x - reach} ${from.y}, ${x - reach} ${to.y}, ${x} ${to.y}`;
          const guided = links.some((each) => each.kind === "guide");
          const chosen =
            focus?.kind === "link" &&
            focus.from === link.from &&
            focus.to === link.to;
          const touches = link.from === lit || link.to === lit;
          const say = links
            .map((each) =>
              each.kind === "name" ? `uses ${each.say}` : each.say,
            )
            .join("; ");
          return (
            // biome-ignore lint/a11y/noStaticElementInteractions: an arc is a mouse target; the backlinks under each idea reach the same places by keyboard
            <g
              key={`${link.from}\n${link.to}`}
              className={[
                "idea-map__arc",
                guided ? "idea-map__arc--guide" : "idea-map__arc--name",
                chosen ? "idea-map__arc--chosen" : "",
                touches
                  ? "idea-map__arc--near"
                  : lit !== null
                    ? "idea-map__arc--far"
                    : "",
              ].join(" ")}
              onClick={() => onLink(link)}
            >
              <title>{say}</title>
              <path className="idea-map__hit" d={path} />
              <path className="idea-map__line" d={path} />
              <circle cx={x} cy={to.y} r={2.5} />
            </g>
          );
        })}
      </svg>
      <ol className="idea-map__list" style={{ height }}>
        {heads.map((head) => (
          <li
            key={head.commitId}
            className="idea-map__commit"
            style={{ top: head.y }}
          >
            <button
              type="button"
              className={
                head.commitId === commitId
                  ? "idea-map__commit-button idea-map__commit-button--current"
                  : "idea-map__commit-button"
              }
              onClick={() => onCommit(head.commitId)}
              title={head.subject}
            >
              <span className="tour-pill">{head.number}</span>
              {head.subject}
            </button>
          </li>
        ))}
        {folds.map((fold) => (
          <li
            key={`fold:${fold.commitId}`}
            className="idea-map__idea"
            style={{ top: fold.y }}
          >
            <button
              type="button"
              className="idea-map__idea-button idea-map__idea-button--rest"
              onClick={() =>
                setUnfolded((now) => {
                  const next = new Set(now);
                  if (next.has(fold.commitId)) next.delete(fold.commitId);
                  else next.add(fold.commitId);
                  return next;
                })
              }
            >
              {unfolded.has(fold.commitId)
                ? "fold the files the guide leaves out"
                : `${fold.count} files the guide leaves out`}
            </button>
          </li>
        ))}
        {tour.commits.flatMap((commit) =>
          commit.ideas.map((idea) => {
            const at = placed.get(idea.id);
            if (at === undefined || !shown.has(idea.id)) return null;
            const state =
              idea.id === lit
                ? "current"
                : near.has(idea.id)
                  ? "near"
                  : lit !== null
                    ? "far"
                    : "";
            return (
              <li
                key={idea.id}
                className="idea-map__idea"
                style={{ top: at.y - ROW / 2 }}
              >
                <button
                  type="button"
                  className={[
                    "idea-map__idea-button",
                    state === "" ? "" : `idea-map__idea-button--${state}`,
                    idea.guided ? "" : "idea-map__idea-button--rest",
                    commit.commitId === commitId
                      ? "idea-map__idea-button--here"
                      : "",
                  ].join(" ")}
                  aria-pressed={focus?.kind === "idea" && focus.id === idea.id}
                  onClick={() => onIdea(idea.id)}
                  title={idea.title}
                >
                  <span className="idea-map__title">{idea.title}</span>
                  <span
                    className="idea-map__size"
                    style={{
                      width: `${Math.max(2, (idea.size / biggest) * 36)}px`,
                    }}
                  />
                </button>
              </li>
            );
          }),
        )}
      </ol>
    </div>
  );
}
```

## Styles

```css
/*| id: design-tour
@layer components {
  .tour {
    display: grid;
    flex: 1;
    grid-template-columns: 300px minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr);
    grid-template-areas: "head head" "map cards";
    min-height: 0;
  }

  .tour--drawer {
    grid-template-columns: 300px minmax(0, 1fr) minmax(0, 0.8fr);
    grid-template-areas: "head head head" "map cards drawer";
  }

  .tour__head {
    display: flex;
    flex-wrap: wrap;
    grid-area: head;
    gap: var(--space-2) var(--space-6);
    align-items: center;
    padding: var(--space-3) var(--space-4);
    background: var(--surface-raised);
    border-bottom: 1px solid var(--border);
  }

  .tour-title {
    display: flex;
    gap: var(--space-4);
    align-items: baseline;
    min-width: 0;
  }

  .tour-title__meta,
  .tour__guided {
    color: var(--text-muted);
  }

  .tour__commits {
    display: flex;
    gap: var(--space-2);
    min-width: 0;
    overflow-x: auto;
  }

  .tour-commit {
    display: flex;
    flex: none;
    gap: var(--space-2);
    align-items: center;
    max-width: 22em;
    padding: var(--space-1) var(--space-3);
    font: inherit;
    color: var(--text);
    cursor: pointer;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 999px;
  }

  .tour-commit--current {
    background: var(--surface-selected);
    border-color: var(--accent);
  }

  .tour-commit__subject {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tour__tools {
    display: flex;
    gap: var(--space-4);
    align-items: center;
    margin-left: auto;
  }

  .tour-toggle {
    padding: var(--space-1) var(--space-3);
    font: inherit;
    color: var(--text);
    cursor: pointer;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 4px;
  }

  .tour-toggle[aria-pressed="true"] {
    background: var(--surface-selected);
  }

  .tour-pill {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    min-width: 1.5em;
    height: 1.5em;
    margin-right: var(--space-2);
    font-size: var(--text-size-small);
    font-weight: bold;
    color: var(--text-inverse);
    background: var(--commit-header-edge);
    border-radius: 999px;
  }

  .tour-link {
    padding: 0;
    font: inherit;
    color: var(--accent);
    text-decoration: underline;
    cursor: pointer;
    background: none;
    border: none;
  }

  .tour__map,
  .tour__cards,
  .tour__drawer {
    min-height: 0;
    overflow: auto;
  }

  .tour__map {
    grid-area: map;
    padding: var(--space-3) var(--space-2);
    background: var(--surface-sunken);
    border-right: 1px solid var(--border);
  }

  .tour__cards {
    grid-area: cards;
    padding: var(--space-4) var(--space-6) 40vh;
  }

  .tour__drawer {
    display: none;
    grid-area: drawer;
    padding: var(--space-3);
    background: var(--surface-sunken);
    border-left: 1px solid var(--border);
  }

  .tour--drawer .tour__drawer {
    display: block;
  }

  .tour-idea {
    margin-bottom: var(--space-8);
  }

  .tour-idea__title {
    display: flex;
    align-items: center;
    margin: 0 0 var(--space-2);
    font-size: calc(var(--text-size) * 1.25);
  }

  .tour-idea--rest .tour-idea__title {
    font-size: var(--text-size);
    color: var(--text-muted);
  }

  .tour-idea__aside {
    margin-left: var(--space-4);
    font-size: var(--text-size-small);
    font-weight: normal;
    color: var(--text-faint);
  }

  .tour-idea__note {
    max-width: 70ch;
    margin: 0 0 var(--space-3);
    line-height: 1.5;
  }

  .tour-links {
    display: flex;
    gap: var(--space-3);
    margin: var(--space-2) 0;
    font-size: var(--text-size-small);
  }

  .tour-links ul {
    padding: 0;
    margin: 0;
    list-style: none;
  }

  .tour-links li {
    margin-bottom: var(--space-1);
  }

  .tour-links__label {
    flex: none;
    width: 9em;
    color: var(--text-muted);
  }

  .tour-wiki {
    padding: 0;
    font: inherit;
    color: var(--accent);
    cursor: pointer;
    background: none;
    border: none;
  }

  .tour-wiki::before {
    color: var(--text-ghost);
    content: "[[";
  }

  .tour-wiki::after {
    color: var(--text-ghost);
    content: "]]";
  }

  .tour-wiki__say {
    color: var(--text-muted);
  }

  .tour-backlinks {
    padding: var(--space-2) var(--space-3);
    margin-top: var(--space-2);
    border-top: 1px dashed var(--border);
  }

  .tour-card {
    margin-bottom: var(--space-4);
    overflow: hidden;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    scroll-margin-top: var(--space-4);
  }

  .tour-card--current {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent);
  }

  .tour-card__head {
    display: flex;
    gap: var(--space-4);
    align-items: baseline;
    padding: var(--space-2) var(--space-3);
    background: var(--surface-raised);
    border-bottom: 1px solid var(--border-subtle);
  }

  .tour-card__path {
    font-weight: bold;
    overflow-wrap: anywhere;
  }

  .tour-card__lines,
  .tour-card__idea {
    color: var(--text-muted);
  }

  .tour-card__idea {
    margin-left: auto;
  }

  .tour-card__note {
    padding: var(--space-2) var(--space-3);
    margin: 0;
    line-height: 1.5;
    background: var(--review-unseen-surface);
    border-bottom: 1px solid var(--border-subtle);
  }

  .tour-card__code {
    overflow-x: auto;
  }

  .tour-row {
    display: flex;
    min-width: max-content;
    line-height: var(--text-line-height);
  }

  .tour-row__no {
    flex: none;
    width: 3.5em;
    padding-right: var(--space-2);
    color: var(--text-ghost);
    text-align: right;
    user-select: none;
  }

  .tour-row__sign {
    flex: none;
    width: 1.5em;
    color: var(--text-faint);
    text-align: center;
    user-select: none;
  }

  .tour-row__code {
    padding-right: var(--space-4);
    font-family: inherit;
    white-space: pre;
  }

  .tour-row--added {
    background: var(--diff-added-surface);
  }

  .tour-row--removed {
    background: var(--diff-removed-surface);
  }

  .tour-card__code .tour-row:not(.tour-row--own) {
    opacity: 0.75;
  }

  .tour-row--own {
    box-shadow: inset 3px 0 var(--accent);
  }

  .tour-row--aim {
    outline: 1px solid var(--accent);
  }

  .tour-flash {
    animation: tour-flash 1.2s ease-out;
  }

  @keyframes tour-flash {
    from {
      background: var(--review-changed-surface);
    }
  }

  .tour-fold {
    display: flex;
    gap: var(--space-3);
    align-items: center;
    padding: var(--space-1) var(--space-3) var(--space-1) 6em;
    color: var(--text-muted);
    background: var(--surface-sunken);
    border-block: 1px solid var(--border-subtle);
  }

  .tour-fold__button {
    padding: 0 var(--space-2);
    font: inherit;
    color: var(--accent);
    cursor: pointer;
    background: none;
    border: 1px solid var(--border);
    border-radius: 3px;
  }

  .tour-name {
    padding: 0;
    font: inherit;
    color: var(--syntax-link);
    text-decoration: underline dotted;
    white-space: pre;
    cursor: pointer;
    background: none;
    border: none;
  }

  .tour-name__commit {
    margin-left: 1px;
    font-size: 0.7em;
    color: var(--commit-header-edge);
  }

  .tour-pop {
    position: fixed;
    z-index: 10;
    display: block;
    width: 460px;
    max-width: 90vw;
    overflow: hidden;
    color: var(--text);
    text-decoration: none;
    white-space: normal;
    cursor: default;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    box-shadow: 0 6px 24px rgb(0 0 0 / 20%);
  }

  .tour-pop__head,
  .tour-pop__foot {
    display: block;
    padding: var(--space-2) var(--space-3);
    color: var(--text-muted);
    background: var(--surface-raised);
  }

  .tour-pop .tour-row__code {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tour-message {
    padding: var(--space-2) var(--space-3);
    margin: 0;
  }

  .tour-message summary {
    font-weight: bold;
    cursor: pointer;
  }

  .tour-message pre {
    margin: var(--space-2) 0 0;
    font-family: inherit;
    white-space: pre-wrap;
  }

  .tour-narrowed {
    position: sticky;
    top: calc(-1 * var(--space-4));
    z-index: 1;
    display: flex;
    gap: var(--space-4);
    align-items: center;
    justify-content: space-between;
    padding: var(--space-2) var(--space-3);
    margin: calc(-1 * var(--space-4)) calc(-1 * var(--space-6)) var(--space-4);
    background: var(--review-changed-surface);
    border-bottom: 1px solid var(--review-changed-border);
  }

  .tour-narrowed__say {
    color: var(--text-muted);
  }

  .tour__end {
    color: var(--text-muted);
  }

  .tour-setup__label {
    margin: 0 0 var(--space-2);
    color: var(--text-muted);
  }

  .tour-peek__rows {
    background: var(--surface);
    border: 1px solid var(--border);
  }

  .tour-row--pullable {
    cursor: pointer;
    opacity: 0.6;
  }

  .tour-row--pullable:hover {
    outline: 1px dashed var(--accent);
    opacity: 1;
  }

  .tour-row--in-card {
    box-shadow: inset 3px 0 var(--accent);
  }

  .tour-list {
    flex: 1;
    min-height: 0;
    max-width: 60em;
    padding: var(--space-4);
    margin: 0;
    overflow: auto;
    list-style: none;
  }

  .tour-list__item {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    width: 100%;
    padding: var(--space-3);
    font: inherit;
    color: var(--text);
    text-align: left;
    cursor: pointer;
    background: none;
    border: none;
    border-bottom: 1px solid var(--border-subtle);
  }

  .tour-list__item:hover {
    background: var(--surface-sunken);
  }

  .tour-list__meta {
    color: var(--text-muted);
  }

  .tour-list__guided {
    padding: 0 var(--space-2);
    margin-left: var(--space-3);
    color: var(--text-inverse);
    background: var(--commit-header-edge);
    border-radius: 999px;
  }

  .idea-map {
    position: relative;
    display: flex;
  }

  .idea-map__arcs {
    flex: none;
    overflow: visible;
  }

  .idea-map__list {
    position: relative;
    flex: 1;
    min-width: 0;
    padding: 0;
    margin: 0;
    list-style: none;
  }

  .idea-map__commit,
  .idea-map__idea {
    position: absolute;
    right: 0;
    left: 0;
  }

  .idea-map__commit-button,
  .idea-map__idea-button {
    display: flex;
    gap: var(--space-2);
    align-items: center;
    width: 100%;
    padding: 0 var(--space-2);
    font: inherit;
    color: var(--text);
    text-align: left;
    cursor: pointer;
    background: none;
    border: none;
    border-radius: 3px;
  }

  .idea-map__commit-button {
    height: 28px;
    overflow: hidden;
    font-weight: bold;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .idea-map__commit-button--current {
    color: var(--accent);
  }

  .idea-map__idea-button {
    height: 24px;
  }

  .idea-map__idea-button:hover,
  .idea-map__commit-button:hover {
    background: var(--surface-raised);
  }

  .idea-map__title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .idea-map__size {
    flex: none;
    height: 6px;
    background: var(--text-ghost);
    border-radius: 3px;
  }

  .idea-map__idea-button--rest {
    font-style: italic;
    color: var(--text-faint);
  }

  .idea-map__idea-button--current {
    font-weight: bold;
    background: var(--surface-selected);
  }

  .idea-map__idea-button--near {
    color: var(--accent);
  }

  .idea-map__idea-button--far {
    opacity: 0.45;
  }

  .idea-map__idea-button[aria-pressed="true"] {
    outline: 1px solid var(--accent);
  }

  .idea-map__arc {
    cursor: pointer;
  }

  .idea-map__hit {
    fill: none;
    stroke: transparent;
    stroke-width: 8;
  }

  .idea-map__line {
    fill: none;
    stroke: var(--text-ghost);
    stroke-width: 1.5;
  }

  .idea-map__arc circle {
    fill: var(--text-ghost);
  }

  .idea-map__arc--guide .idea-map__line {
    stroke: var(--commit-header-edge);
    stroke-width: 2;
  }

  .idea-map__arc--name .idea-map__line {
    stroke-dasharray: 3 3;
  }

  .idea-map__arc--far {
    opacity: 0.2;
  }

  .idea-map__arc--near .idea-map__line,
  .idea-map__arc:hover .idea-map__line {
    stroke: var(--accent);
    stroke-width: 2.5;
  }

  .idea-map__arc--chosen .idea-map__line {
    stroke: var(--danger);
    stroke-width: 3;
  }
}

@layer components-narrow {
  @media (max-width: 1100px) {
    .tour,
    .tour--drawer {
      grid-template-columns: 240px minmax(0, 1fr);
      grid-template-areas: "head head" "map cards";
    }

    .tour--drawer .tour__drawer,
    .tour-toggle--drawer {
      display: none;
    }
  }

  /* A phone reads one column: the map folds above the cards, and a pair's
     setup reads above its payoff. */
  @media (max-width: 760px) {
    .tour,
    .tour--drawer {
      display: flex;
      flex-direction: column;
      overflow: auto;
    }

    .tour__map {
      flex: none;
      max-height: 35vh;
      border-right: none;
      border-bottom: 1px solid var(--border);
    }

    .tour__cards {
      flex: none;
      padding: var(--space-3) var(--space-2) 40vh;
      overflow: visible;
    }

    .tour--pair .tour__drawer {
      display: block;
      flex: none;
      order: 2;
      overflow: visible;
      border-left: none;
    }

    .tour--pair .tour__cards {
      order: 3;
    }

    .tour__tools {
      margin-left: 0;
    }

    .tour-narrowed {
      top: 0;
      margin-inline: calc(-1 * var(--space-2));
    }
  }
}
```

## Tests

```ts
//| id: frontend-model-tour-test
//| file: src/frontend/model/tour.test.ts
import { describe, expect, test } from "bun:test";
import type { FileDiff } from "./diff";
import type { Guide } from "./guide";
import {
  buildTour,
  type CommitInput,
  fileOrder,
  stopSpan,
  tourFile,
} from "./tour";

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
+export function applyCommand(doc) {
 three
@@ -20,2 +20,3 @@
 twenty
+twenty-one
 twenty-two
`,
);

const SERVER = diff(
  "server.ts",
  `--- a/server.ts
+++ b/server.ts
@@ -5,2 +5,3 @@
 five
+  return applyCommand(read());
 six
`,
);

function commit(id: string, ...files: FileDiff[]): CommitInput {
  return {
    commitId: id,
    description: `${id}: subject\n\nbody`,
    files: files.map((file) => tourFile(file, null)),
  };
}

const GUIDE: Guide = {
  series: "local:x",
  version: "1",
  author: "claude",
  writtenAt: "t",
  ideas: [
    {
      id: "apply",
      commitId: "c1",
      title: "One function applies them",
      note: "",
      stops: [
        { path: "store.ts", side: "after", start: 2, end: 2, note: "here" },
      ],
    },
    {
      id: "serve",
      commitId: "c2",
      title: "The server applies too",
      note: "",
      stops: [{ side: "after", note: "the message" }],
    },
  ],
  links: [{ from: "serve", to: "apply", say: "the same function" }],
};

describe("tourFile", () => {
  test("puts the unchanged lines between hunks back, and the tail once its length is known", () => {
    // arrange
    // act
    const rows = tourFile(STORE, 23).rows;

    // assert
    expect(rows.map((row) => row.kind[0]).join("")).toBe(
      `crac${"c".repeat(16)}cacc`,
    );
    expect(rows.at(-1)).toEqual({
      kind: "context",
      old: 22,
      new: 23,
      code: null,
    });
    expect(tourFile(STORE, null).rows).toHaveLength(23);
  });

  test("reads a stop's lines with the lines its first line replaced", () => {
    // arrange
    const file = tourFile(STORE, 23);

    // act
    // assert
    expect(
      stopSpan(file, { side: "after", start: 2, end: 2, note: "" }),
    ).toEqual([1, 2]);
    expect(stopSpan(file, { side: "before", start: 2, note: "" })).toEqual([
      1, 1,
    ]);
    expect(stopSpan(file, { side: "after", start: 90, note: "" })).toBeNull();
  });
});

describe("buildTour", () => {
  test("reads the guide's ideas first and gathers what it left out by file", () => {
    // arrange
    // act
    const tour = buildTour([commit("c1", STORE), commit("c2", SERVER)], GUIDE);

    // assert
    const [first, second] = tour.commits;
    expect(
      first?.ideas.map((idea) => [idea.title, idea.guided, idea.size]),
    ).toEqual([
      ["One function applies them", true, 2],
      ["store.ts", false, 1],
    ]);
    expect(second?.ideas.map((idea) => idea.title)).toEqual([
      "The server applies too",
      "server.ts",
    ]);
    if (second === undefined) throw new Error("no second commit");
    expect(fileOrder(second).map((card) => card.kind)).toEqual([
      "message",
      "file",
    ]);
  });

  test("links an idea using a name to the idea that introduced it", () => {
    // arrange
    // act
    const tour = buildTour([commit("c1", STORE), commit("c2", SERVER)], GUIDE);

    // assert
    expect(tour.names.map((name) => [name.name, name.usedAt.length])).toEqual([
      ["applyCommand", 1],
    ]);
    expect(tour.links).toEqual([
      { from: "serve", to: "apply", kind: "guide", say: "the same function" },
      { from: "c2:server.ts", to: "apply", kind: "name", say: "applyCommand" },
    ]);
  });

  test("reads a series with no guide file by file", () => {
    // arrange
    // act
    const tour = buildTour([commit("c1", STORE)], undefined);

    // assert
    expect(tour.commits[0]?.ideas).toEqual([
      expect.objectContaining({ id: "c1:store.ts", guided: false }),
    ]);
    expect(tour.commits[0]?.ideas[0]?.cards[0]).toMatchObject({
      spans: [
        [0, 3],
        [20, 22],
      ],
    });
  });
});
```
