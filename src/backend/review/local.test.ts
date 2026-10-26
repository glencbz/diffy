// ~/~ begin <<docs/architecture/backend/local-reviews.md#backend-local-reviews-test>>[init]
import { describe, expect, test } from "bun:test";
import { applyCommand, EMPTY_REVIEW } from "../../frontend/model/review";
import { FIXED } from "../../testing/history";
import {
  localCommits,
  localDiff,
  localSize,
  RegistrationError,
  registrationDefaults,
  resolveRegistration,
} from "./local";

/** The repository these tests read. */
const ROOT = process.cwd();

describe("resolveRegistration", () => {
  test("names the commits the revset held, oldest first", async () => {
    // arrange
    const asked = { name: "t", revset: `${FIXED.parent} | ${FIXED.commit}` };

    // act
    const { name, version } = await resolveRegistration(
      ROOT,
      EMPTY_REVIEW,
      asked,
      "now",
    );

    // assert
    expect(name).toBe("t");
    expect(version.commits).toHaveLength(2);
    expect(version.commits).toEqual([FIXED.parent, FIXED.commit]);
    expect(version.revset).toBe(asked.revset);
    expect(version.operation).toMatch(/^[0-9a-f]+$/);
  });

  test("refuses a revset that names nothing", async () => {
    // arrange
    // act
    const attempt = resolveRegistration(
      ROOT,
      EMPTY_REVIEW,
      { name: "t", revset: "none()" },
      "now",
    );

    // assert
    expect(attempt).rejects.toBeInstanceOf(RegistrationError);
  });
});

describe("registrationDefaults", () => {
  test("takes the revset of the review's last version", async () => {
    // arrange
    const document = applyCommand(EMPTY_REVIEW, {
      kind: "register",
      name: "t",
      version: {
        operation: "o1",
        revset: "trunk()",
        commits: ["c"],
        registeredAt: "then",
      },
    });

    // act
    const defaults = await registrationDefaults(ROOT, document, { name: "t" });

    // assert
    expect(defaults.revset).toBe("trunk()");
  });

  test("reads a new name as the bookmark of that name", async () => {
    // arrange
    // act
    const defaults = await registrationDefaults(ROOT, EMPTY_REVIEW, {
      name: "my-branch",
    });

    // assert
    expect(defaults.name).toBe("my-branch");
    expect(defaults.revset).toBe('trunk().."my-branch"');
  });
});

describe("reading a version", () => {
  test("reads commits in the order asked, with their change ids", async () => {
    // arrange
    const ids = [FIXED.parent, FIXED.commit];

    // act
    const commits = await localCommits(ROOT, ids);

    // assert
    expect(commits.map((commit) => commit.commitId).join()).toBe(ids.join());
    expect(commits.map((commit) => commit.changeId)).toEqual([
      FIXED.parentChangeId,
      FIXED.changeId,
    ]);
  });

  test("diffs a lone commit, a pair, and a whole version", async () => {
    // arrange
    const [older, newer] = [FIXED.parent, FIXED.commit];

    // act
    const lone = await localDiff(ROOT, null, newer);
    const pair = await localDiff(ROOT, older, newer);
    const whole = await localSize(ROOT, [older, newer]);

    // assert
    expect(lone.length).toBeGreaterThan(0);
    expect(Array.isArray(pair)).toBe(true);
    expect(whole.length).toBeGreaterThanOrEqual(lone.length);
  });
});
// ~/~ end
