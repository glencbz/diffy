// ~/~ begin <<docs/architecture/frontend/guide.md#frontend-model-guide-test>>[init]
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
// ~/~ end
