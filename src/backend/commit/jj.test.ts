// ~/~ begin <<docs/architecture/backend/jj.md#jj-module-test>>[init]
import { describe, expect, test } from "bun:test";
import {
  JjError,
  jjCommits,
  jjDiff,
  jjInterdiff,
  jjLog,
  jjOpLog,
  parseFileDiff,
} from "./jj";

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

  test("reads the log at a past operation", async () => {
    // arrange
    const operations = await jjOpLog();
    const earlier = operations.at(-1);

    // act
    const entries = await jjLog({
      revset: "all()",
      atOperation: earlier?.id,
    });

    // assert
    expect(entries.length).toBeGreaterThan(0);
  });

  test("wraps an unknown operation id in JjError", async () => {
    // arrange
    // act
    // assert
    await expect(
      jjLog({ atOperation: "no-such-operation-xyz" }),
    ).rejects.toBeInstanceOf(JjError);
  });
});

describe("jjOpLog", () => {
  test("lists operations newest first", async () => {
    // arrange
    // act
    const operations = await jjOpLog();

    // assert
    expect(operations.length).toBeGreaterThan(0);
    for (const op of operations) {
      expect(typeof op.id).toBe("string");
      expect(typeof op.description).toBe("string");
      expect(typeof op.args).toBe("string");
      expect(Number.isNaN(Date.parse(op.time))).toBe(false);
    }

    const times = operations.map((op) => Date.parse(op.time));
    const sorted = [...times].sort((a, b) => b - a);
    expect(times).toEqual(sorted);
  });

  test("respects the limit option", async () => {
    // arrange
    // act
    const operations = await jjOpLog({ limit: 1 });

    // assert
    expect(operations).toHaveLength(1);
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
// ~/~ begin <<docs/architecture/backend/jj.md#jj-module-test>>[2]

/** The commit id of the single commit `revset` names. */
async function commitId(revset: string): Promise<string> {
  const [entry] = await jjLog({ revset, limit: 1 });
  if (entry === undefined) throw new Error(`no commit matches ${revset}`);
  return entry.commitId;
}

describe("jjCommits", () => {
  test("keys the requested commits by commit id", async () => {
    // arrange
    const entries = await jjLog({ revset: "all()", limit: 3 });
    const ids = entries.map((entry) => entry.commitId);

    // act
    const found = await jjCommits(ids);

    // assert
    expect([...found.keys()].sort()).toEqual([...ids].sort());
    for (const id of ids) expect(found.get(id)?.commitId).toBe(id);
  });

  test("asks jj nothing when given no ids", async () => {
    // arrange
    // act
    // assert
    expect(await jjCommits([])).toEqual(new Map());
  });

  test("wraps an unresolvable id in JjError", async () => {
    // arrange
    // act
    // assert
    await expect(jjCommits(["no-such-commit-xyz"])).rejects.toBeInstanceOf(
      JjError,
    );
  });
});

describe("jjInterdiff", () => {
  test("reports no difference between a commit and itself", async () => {
    // arrange
    const id = await commitId("root()+");

    // act
    // assert
    expect(await jjInterdiff({ from: id, to: id })).toEqual([]);
  });

  test("reports the difference between two unrelated changes", async () => {
    // arrange
    const from = await commitId("root()+");
    const to = await commitId("root()++");

    // act
    const files = await jjInterdiff({ from, to });

    // assert
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(file.patch.startsWith("diff --git ")).toBe(true);
    }
  });

  test("compares a commit from an old operation without --at-operation", async () => {
    // arrange
    const operations = await jjOpLog();
    const oldest = operations.at(-1);
    const [before] = await jjLog({
      revset: "all()",
      limit: 1,
      atOperation: oldest?.id,
    });
    if (before === undefined) throw new Error("no commit at the oldest op");

    // act
    const files = await jjInterdiff({
      from: before.commitId,
      to: await commitId("@"),
    });

    // assert
    expect(Array.isArray(files)).toBe(true);
  });

  test("wraps an unresolvable commit in JjError", async () => {
    // arrange
    const attempt = () => jjInterdiff({ from: "no-such-commit-xyz", to: "@" });

    // act
    // assert
    await expect(attempt()).rejects.toBeInstanceOf(JjError);
    await expect(attempt()).rejects.toThrow(/doesn't exist/);
  });
});
// ~/~ end
