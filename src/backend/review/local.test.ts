// ~/~ begin <<docs/architecture/backend/local-reviews.md#backend-local-reviews-test>>[init]
import { describe, expect, test } from "bun:test";
import { applyCommand, EMPTY_REVIEW } from "../../frontend/model/review";
import { jjLog } from "../commit/jj";
import {
  localCommits,
  localDiff,
  localSize,
  RegistrationError,
  registrationDefaults,
  resolveRegistration,
} from "./local";

async function tipCommit(): Promise<string> {
  const [entry] = await jjLog({ revset: "latest(::trunk() ~ empty())" });
  if (entry === undefined) throw new Error("no history");
  return entry.commitId;
}

describe("resolveRegistration", () => {
  test("names the commits the revset held, oldest first", async () => {
    // arrange
    const tip = "latest(::trunk() ~ empty())";
    const asked = { name: "t", revset: `${tip}- | ${tip}` };

    // act
    const { name, version } = await resolveRegistration(
      EMPTY_REVIEW,
      asked,
      "now",
    );

    // assert
    expect(name).toBe("t");
    expect(version.commits).toHaveLength(2);
    expect(version.commits.at(-1)).toBe(await tipCommit());
    expect(version.revset).toBe(asked.revset);
    expect(version.operation).toMatch(/^[0-9a-f]+$/);
  });

  test("refuses a revset that names nothing", async () => {
    // arrange
    // act
    const attempt = resolveRegistration(
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
    const defaults = await registrationDefaults(document, { name: "t" });

    // assert
    expect(defaults.revset).toBe("trunk()");
  });

  test("reads a new name as the bookmark of that name", async () => {
    // arrange
    // act
    const defaults = await registrationDefaults(EMPTY_REVIEW, {
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
    const tip = "latest(::trunk() ~ empty())";
    const entries = await jjLog({ revset: `${tip}- | ${tip}` });
    const ids = entries.map((entry) => entry.commitId).reverse();

    // act
    const commits = await localCommits(ids);

    // assert
    expect(commits.map((commit) => commit.commitId).join()).toBe(ids.join());
    expect(commits.every((commit) => commit.changeId !== null)).toBe(true);
  });

  test("diffs a lone commit, a pair, and a whole version", async () => {
    // arrange
    const tip = "latest(::trunk() ~ empty())";
    const [newer, older] = (await jjLog({ revset: `${tip} | ${tip}-` })).map(
      (entry) => entry.commitId,
    );
    if (newer === undefined || older === undefined) throw new Error("history");

    // act
    const lone = await localDiff(null, newer);
    const pair = await localDiff(older, newer);
    const whole = await localSize([older, newer]);

    // assert
    expect(lone.length).toBeGreaterThan(0);
    expect(Array.isArray(pair)).toBe(true);
    expect(whole.length).toBeGreaterThanOrEqual(lone.length);
  });
});
// ~/~ end
