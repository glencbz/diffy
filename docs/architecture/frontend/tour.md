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

export interface Tour {
  commits: TourCommit[];
}

export function buildTour(
  inputs: CommitInput[],
  guide: Guide | undefined,
): Tour {
  return {
    commits: inputs.map((input, index) =>
      tourCommit(
        input,
        index + 1,
        (guide?.ideas ?? []).filter((idea) => idea.commitId === input.commitId),
      ),
    ),
  };
}
```

## The tabs

Each kind of series has a tour tab beside its own screen, which stays as it
is, so the reader can fall back to the commit stack for anything the tour
does not do, such as comments and marks. A tour reads the newest version
only, the one the guide is written to.

The controller loads every commit's diff before drawing, so switching
commits never waits, and highlights only the files on screen.

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
import type { LocalTourPlace, PullTourPlace, TourSpot } from "../model/place";
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
        onSelect={(name) => onGo({ name, commit: null })}
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
        onSelect={(key) => onGo({ number: Number(key), commit: null })}
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
  const wanted = useMemo(() => filesOf(diffs, commitId), [diffs, commitId]);
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
      onGo={(commit: string) => onGo({ commit: GitOid.parse(commit) })}
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

Two columns: the current commit's cards, and a drawer with the whole file of
the card being read. The card being read is the one across a line a third of
the way down the cards, where the eye sits while scrolling.

```tsx
//| id: frontend-view-tour
//| file: src/frontend/views/Tour/Tour.tsx
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { SourceLookup } from "../../model/source";
import {
  fileOrder,
  type Span,
  type TourCard,
  type TourCommit,
  type TourIdea,
  type Tour as TourModel,
} from "../../model/tour";
import { CardView } from "./CardView";
import { Peek } from "./Peek";

/** What the reader has asked of the tour that the address does not keep. */
type Order = "story" | "file";

export interface TourProps {
  tour: TourModel;
  /** The commit on screen, which the address names. */
  commitId: string;
  onGo: (commitId: string) => void;
  source: SourceLookup;
  header: ReactNode;
  /** Who wrote the guide and when, or null for a series with none. */
  guidedBy: string | null;
}

export function Tour({
  tour,
  commitId,
  onGo,
  source,
  header,
  guidedBy,
}: TourProps) {
  const commit =
    tour.commits.find((each) => each.commitId === commitId) ?? tour.commits[0];
  const [order, setOrder] = useState<Order>("story");
  const [drawer, setDrawer] = useState(true);
  const [opened, setOpened] = useState<ReadonlyMap<string, Span[]>>(new Map());
  const [current, setCurrent] = useState<string | null>(null);
  const cardsRef = useRef<HTMLDivElement>(null);

  const cards: TourCard[] =
    commit === undefined
      ? []
      : order === "file"
        ? fileOrder(commit)
        : commit.ideas.flatMap((idea) => idea.cards);
  const currentCard =
    cards.find((card) => card.key === current) ?? cards[0] ?? null;

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

  // A new commit starts at the top.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scrolls only when what is read changes
  useEffect(() => {
    if (cardsRef.current !== null) cardsRef.current.scrollTop = 0;
  }, [commit?.commitId, order]);

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
        if (chosen !== undefined) onGo(chosen.commitId);
      } else if (event.key === "n" || event.key === "j") step(1);
      else if (event.key === "p" || event.key === "k") step(-1);
      else if (event.key === "o")
        setOrder(order === "story" ? "file" : "story");
      else if (event.key === " ") setDrawer(!drawer);
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

  const card = (each: TourCard, idea: TourIdea | undefined) => (
    <CardView
      key={each.key}
      card={each}
      commit={commit}
      idea={idea}
      current={each.key === currentCard?.key}
      opened={opened.get(each.key) ?? []}
      onOpen={(span) => open(each.key, span)}
      source={source}
    />
  );

  // A message card shows the message itself, so the drawer looks ahead to
  // the next file the commit reads.
  const peekCard =
    cards
      .slice(Math.max(0, cards.indexOf(currentCard as TourCard)))
      .find((each) => each.kind === "file") ?? null;

  return (
    <div className={drawer ? "tour tour--drawer" : "tour"}>
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
              onClick={() => onGo(each.commitId)}
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
      <main className="tour__cards" ref={cardsRef}>
        {order === "file" ? (
          <section className="tour-idea">
            <h2 className="tour-idea__title">
              <span className="tour-pill">{commit.number}</span>
              {commit.subject}
            </h2>
            {cards.map((each) =>
              card(
                each,
                commit.ideas.find((idea) => idea.id === each.ideaId),
              ),
            )}
          </section>
        ) : (
          commit.ideas.map((idea) => (
            <IdeaSection key={idea.id} idea={idea} commit={commit}>
              {idea.cards.map((each) => card(each, undefined))}
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
                if (next !== undefined) onGo(next.commitId);
              }}
            >
              On to commit {commit.number + 1}
            </button>
          )}
        </p>
      </main>
      <aside className="tour__drawer">
        {peekCard !== null ? (
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

function IdeaSection({
  idea,
  commit,
  children,
}: {
  idea: TourIdea;
  commit: TourCommit;
  children: ReactNode;
}) {
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
      {children}
    </section>
  );
}
```

### Cards

```tsx
//| id: frontend-view-tour-card
//| file: src/frontend/views/Tour/CardView.tsx
import type { ReactNode } from "react";
import type { SourceLookup, SyntaxToken } from "../../model/source";
import type {
  FileRow,
  Span,
  TourCard,
  TourCommit,
  TourFile,
  TourIdea,
} from "../../model/tour";

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
  className = "",
  onClick,
}: {
  file: TourFile;
  index: number;
  source: SourceLookup;
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
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: tokens of one line never move
            key={at}
            className={
              token.kind === null ? undefined : `syntax--${token.kind}`
            }
          >
            {token.text}
          </span>
        ))}
      </code>
    </div>
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

## Styles

```css
/*| id: design-tour
@layer components {
  .tour {
    display: grid;
    flex: 1;
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr);
    grid-template-areas: "head" "cards";
    min-height: 0;
  }

  .tour--drawer {
    grid-template-columns: minmax(0, 1fr) minmax(0, 0.8fr);
    grid-template-areas: "head head" "cards drawer";
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
}

@layer components-narrow {
  @media (max-width: 1100px) {
    .tour--drawer {
      grid-template-columns: minmax(0, 1fr);
      grid-template-areas: "head" "cards";
    }

    .tour--drawer .tour__drawer,
    .tour-toggle--drawer {
      display: none;
    }
  }

  @media (max-width: 760px) {
    .tour__cards {
      padding: var(--space-3) var(--space-2) 40vh;
    }

    .tour__tools {
      margin-left: 0;
    }
  }
}
```

## Tests

```ts
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
