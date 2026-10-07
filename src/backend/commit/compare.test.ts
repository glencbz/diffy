// ~/~ begin <<docs/architecture/backend/compare.md#compare-module-test>>[init]
import { describe, expect, test } from "bun:test";
import { $ } from "bun";
import { beforePaths, CompareError, compareFiles } from "./compare";
import { GitOid } from "./git";

async function oidOf(revision: string): Promise<GitOid> {
  return GitOid.parse(
    (await $`git rev-parse ${revision}`.quiet().text()).trim(),
  );
}

describe("compareFiles", () => {
  test("diffs two paths as a rename, with the blobs each side holds", async () => {
    // arrange
    const to = await oidOf("main");
    const oldBlob = (
      await $`git rev-parse main^:package.json`.quiet().text()
    ).trim();

    // act
    const file = await compareFiles(
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
    const from = await oidOf("main~3");
    const to = await oidOf("main");

    // act
    const file = await compareFiles({ from, to }, "justfile", "justfile");

    // assert
    expect(file.oldBlob).toBe(
      (await $`git rev-parse main~3:justfile`.quiet().text()).trim(),
    );
  });

  test("refuses a path the side does not hold", async () => {
    // arrange
    const to = await oidOf("main");

    // act
    const compared = compareFiles(
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
    const to = await oidOf("main");

    // act
    const paths = await beforePaths({ from: null, to });

    // assert
    expect(paths).toContain("package.json");
    expect(paths).toContain("docs/architecture/backend/git.md");
  });
});
// ~/~ end
