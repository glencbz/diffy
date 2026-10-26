// ~/~ begin <<docs/architecture/backend/compare.md#compare-module-test>>[init]
import { describe, expect, test } from "bun:test";
import { $ } from "bun";
import { FIXED } from "../../testing/history";
import { beforePaths, CompareError, compareFiles } from "./compare";
import { GitOid } from "./git";

/** The repository these tests read. */
const ROOT = process.cwd();
const COMMIT = GitOid.parse(FIXED.commit);
const PARENT = GitOid.parse(FIXED.parent);

describe("compareFiles", () => {
  test("diffs two paths as a rename, with the blobs each side holds", async () => {
    // arrange
    const to = COMMIT;
    const oldBlob = (
      await $`git rev-parse ${PARENT}:package.json`.quiet().text()
    ).trim();

    // act
    const file = await compareFiles(
      ROOT,
      { from: null, to },
      "package.json",
      "tsconfig.json",
    );

    // assert
    expect(file.status).toBe("renamed");
    expect(file).toMatchObject({
      oldPath: "package.json",
      newPath: "tsconfig.json",
      oldBlob,
      binary: false,
    });
    expect(file.patch).toContain("\n@@ ");
  });

  test("reads the older commit's tree when the row has one", async () => {
    // arrange
    const [from, to] = [PARENT, COMMIT];

    // act
    const file = await compareFiles(ROOT, { from, to }, "justfile", "justfile");

    // assert
    expect(file.oldBlob).toBe(
      (await $`git rev-parse ${PARENT}:justfile`.quiet().text()).trim(),
    );
  });

  test("refuses a path the side does not hold", async () => {
    // arrange
    const to = COMMIT;

    // act
    const compared = compareFiles(
      ROOT,
      { from: null, to },
      "no/such/file.ts",
      "package.json",
    );

    // assert
    expect(compared).rejects.toBeInstanceOf(CompareError);
  });
});

describe("beforePaths", () => {
  test("lists the parent's tree for a commit's own diff", async () => {
    // arrange
    const to = COMMIT;

    // act
    const paths = await beforePaths(ROOT, { from: null, to });

    // assert
    expect(paths).toContain("package.json");
    expect(paths).toContain("docs/architecture/backend/git.md");
  });
});
// ~/~ end
