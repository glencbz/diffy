// ~/~ begin <<docs/architecture/backend/jj.md#jj-module-test>>[init]
import { describe, expect, test } from "bun:test";
import { JjError, jjDiff, jjLog, parseFileDiff } from "./jj";

describe("jjLog", () => {
  test("lists every commit, including the root", async () => {
    // arrange
    // act
    const entries = await jjLog({ revset: "all()" });

    // assert
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(typeof entry.commitId).toBe("string");
      expect(typeof entry.changeId).toBe("string");
      expect(typeof entry.description).toBe("string");
      expect(Array.isArray(entry.parents)).toBe(true);
    }

    const root = entries.at(-1);
    expect(root?.commitId).toBe("0".repeat(40));
    expect(root?.changeId).toBe("z".repeat(32));
  });

  test("respects the limit option", async () => {
    // arrange
    // act
    const entries = await jjLog({ revset: "all()", limit: 1 });

    // assert
    expect(entries).toHaveLength(1);
  });

  test("wraps an unresolvable revset in JjError", async () => {
    // arrange
    // act
    // assert
    await expect(
      jjLog({ revset: "no-such-revision-xyz" }),
    ).rejects.toBeInstanceOf(JjError);
  });
});
// ~/~ end
// ~/~ begin <<docs/architecture/backend/jj.md#jj-module-test>>[1]

describe("parseFileDiff", () => {
  test("added text file", () => {
    // arrange
    const patch = [
      "diff --git a/add.txt b/add.txt",
      "new file mode 100644",
      "index 0000000000..d5a09df94c",
      "--- /dev/null",
      "+++ b/add.txt",
      "@@ -0,0 +1,1 @@",
      "+brand new",
    ].join("\n");

    // act
    // assert
    expect(parseFileDiff(patch)).toMatchObject({
      status: "added",
      path: "add.txt",
      binary: false,
    });
  });

  test("deleted text file", () => {
    // arrange
    const patch = [
      "diff --git a/del.txt b/del.txt",
      "deleted file mode 100644",
      "index de980441c3..0000000000",
      "--- a/del.txt",
      "+++ /dev/null",
      "@@ -1,3 +0,0 @@",
      "-a",
    ].join("\n");

    // act
    // assert
    expect(parseFileDiff(patch)).toMatchObject({
      status: "deleted",
      path: "del.txt",
      binary: false,
    });
  });

  test("modified text file", () => {
    // arrange
    const patch = [
      "diff --git a/mod.txt b/mod.txt",
      "index 04ec35a6dc..0722639108 100644",
      "--- a/mod.txt",
      "+++ b/mod.txt",
      "@@ -1,3 +1,4 @@",
      " x",
      "+new line",
    ].join("\n");

    // act
    // assert
    expect(parseFileDiff(patch)).toMatchObject({
      status: "modified",
      path: "mod.txt",
      binary: false,
    });
  });

  test("rename with no ---/+++ lines", () => {
    // arrange
    const patch = [
      "diff --git a/t.txt b/renamed.txt",
      "rename from t.txt",
      "rename to renamed.txt",
    ].join("\n");

    // act
    // assert
    expect(parseFileDiff(patch)).toEqual({
      status: "renamed",
      oldPath: "t.txt",
      newPath: "renamed.txt",
      binary: false,
      patch,
    });
  });

  test("binary modification", () => {
    // arrange
    const patch = [
      "diff --git a/b.bin b/b.bin",
      "index cc232b734a..95d534dc0b 100644",
      "Binary files a/b.bin and b/b.bin differ",
    ].join("\n");

    // act
    // assert
    expect(parseFileDiff(patch)).toMatchObject({
      status: "modified",
      path: "b.bin",
      binary: true,
    });
  });

  test("binary addition (only the new side exists)", () => {
    // arrange
    const patch = [
      "diff --git a/addbin.bin b/addbin.bin",
      "new file mode 100644",
      "index 0000000000..73d04aa0b2",
      "Binary files /dev/null and b/addbin.bin differ",
    ].join("\n");

    // act
    // assert
    expect(parseFileDiff(patch)).toMatchObject({
      status: "added",
      path: "addbin.bin",
      binary: true,
    });
  });
});

describe("jjDiff", () => {
  test("parses the first commit as a set of added files", async () => {
    // arrange
    // act
    const files = await jjDiff({ revision: "root()+" });

    // assert
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(file.status).toBe("added");
      expect(file.patch.startsWith("diff --git ")).toBe(true);
    }
  });

  test("returns an empty list for a commit with no changes", async () => {
    // arrange
    // act
    // assert
    expect(await jjDiff({ revision: "root()" })).toEqual([]);
  });

  test("defaults to the working-copy revision", async () => {
    // arrange
    // act
    const [viaDefault, viaExplicit] = await Promise.all([
      jjDiff(),
      jjDiff({ revision: "@" }),
    ]);

    // assert
    expect(viaDefault).toEqual(viaExplicit);
  });

  test("wraps an unresolvable revision in JjError", async () => {
    // arrange
    const attempt = () => jjDiff({ revision: "no-such-revision-xyz" });

    // act
    // assert
    await expect(attempt()).rejects.toBeInstanceOf(JjError);
    await expect(attempt()).rejects.toThrow(/doesn't exist/);
  });
});
// ~/~ end
