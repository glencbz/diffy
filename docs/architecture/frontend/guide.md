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
