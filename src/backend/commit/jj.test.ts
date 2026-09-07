// ~/~ begin <<docs/architecture/backend/jj.md#jj-module-test>>[init]
import { describe, expect, test } from "bun:test";
import { jjLog } from "./jj";

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
});
// ~/~ end
