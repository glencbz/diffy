// ~/~ begin <<docs/architecture/backend/git.md#git-module-test>>[init]

import { describe, expect, test } from "bun:test";
import { $ } from "bun";
import { BlobId, GitOid } from "../../model/history";
import { FIXED } from "../../testing/history";
import { gitBlob, gitFiles } from "./git";

/** The repository these tests read. */
const ROOT = process.cwd();

const COMMIT = GitOid.parse(FIXED.commit);

describe("gitBlob", () => {
  test("reads a file back by the blob id a tree holds it under", async () => {
    // arrange
    const id = BlobId.parse(
      (await $`git rev-parse ${COMMIT}:package.json`.quiet().text()).trim(),
    );

    // act
    const text = await gitBlob(ROOT, id);

    // assert
    expect(text).toBe(await $`git show ${COMMIT}:package.json`.quiet().text());
  });

  test("answers null for an id that names nothing", async () => {
    // arrange
    // act
    // assert
    expect(await gitBlob(ROOT, BlobId.parse("f".repeat(40)))).toBeNull();
  });
});
// ~/~ end
// ~/~ begin <<docs/architecture/backend/git.md#git-module-test>>[1]

describe("gitFiles", () => {
  test("lists a commit's tree, nested paths included", async () => {
    // arrange
    const head = COMMIT;

    // act
    const files = await gitFiles(ROOT, head);

    // assert
    expect(files).toContain("package.json");
    expect(files).toContain("src/server.ts");
  });

  test("lists nothing for a revision git cannot name", async () => {
    // arrange
    // act
    // assert
    expect(await gitFiles(ROOT, "f".repeat(40))).toEqual([]);
  });
});
// ~/~ end
