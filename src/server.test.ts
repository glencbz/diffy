// ~/~ begin <<docs/architecture/backend/server.md#backend-server-test>>[init]
import { describe, expect, test } from "bun:test";
import { jjLog } from "./backend/commit/jj";
import {
  handleDiff,
  handleInterdiff,
  handleLog,
  handleOperations,
} from "./server";

/** The commit id of the single commit `revset` names. */
async function commitId(revset: string): Promise<string> {
  const [entry] = await jjLog({ revset, limit: 1 });
  if (entry === undefined) throw new Error(`no commit matches ${revset}`);
  return entry.commitId;
}

describe("handleLog", () => {
  test("returns the commit log as an array", async () => {
    // arrange
    // act
    const res = await handleLog(new Request("http://test/api/log"));
    const body = (await res.json()) as unknown[];

    // assert
    expect(res.status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
  });

  test("reports an unknown operation as 400 with jj's message", async () => {
    // arrange
    // act
    const res = await handleLog(
      new Request("http://test/api/log?op=no-such-op-xyz"),
    );
    const body = (await res.json()) as { error: string };

    // assert
    expect(res.status).toBe(400);
    expect(typeof body.error).toBe("string");
  });
});

describe("handleOperations", () => {
  test("returns the operation log as a non-empty array", async () => {
    // arrange
    // act
    const res = await handleOperations();
    const body = (await res.json()) as unknown[];

    // assert
    expect(res.status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
  });
});

describe("handleDiff", () => {
  test("returns the revision and its file diffs", async () => {
    // arrange
    // act
    const res = await handleDiff(
      new Request("http://test/api/diff?rev=root()%2B"),
    );

    // assert
    expect(res.status).toBe(200);
    const body = (await res.json()) as { revision: string; files: unknown[] };
    expect(body.revision).toBe("root()+");
    expect(body.files.length).toBeGreaterThan(0);
  });

  test("defaults the revision to @", async () => {
    // arrange
    // act
    const res = await handleDiff(new Request("http://test/api/diff"));
    const body = (await res.json()) as { revision: string };

    // assert
    expect(res.status).toBe(200);
    expect(body.revision).toBe("@");
  });

  test("reports an unresolvable revision as 400 with jj's message", async () => {
    // arrange
    // act
    const res = await handleDiff(
      new Request("http://test/api/diff?rev=no-such-xyz"),
    );
    const body = (await res.json()) as { error: string };

    // assert
    expect(res.status).toBe(400);
    expect(body.error).toMatch(/doesn't exist/);
  });
});

describe("handleInterdiff", () => {
  function request(params: Record<string, string>): Request {
    return new Request(
      `http://test/api/interdiff?${new URLSearchParams(params)}`,
    );
  }

  test("echoes both commits and the files they differ in", async () => {
    // arrange
    const from = await commitId("root()+");
    const to = await commitId("root()++");

    // act
    const res = await handleInterdiff(request({ from, to }));
    const body = (await res.json()) as {
      from: { commitId: string };
      to: { commitId: string };
      files: unknown[];
    };

    // assert
    expect(res.status).toBe(200);
    expect(body.from.commitId).toBe(from);
    expect(body.to.commitId).toBe(to);
    expect(body.files.length).toBeGreaterThan(0);
  });

  test("falls back to a commit's own diff when one side is missing", async () => {
    // arrange
    const to = await commitId("root()+");

    // act
    const res = await handleInterdiff(request({ to }));
    const body = (await res.json()) as {
      from: null;
      to: { commitId: string };
      files: { status: string }[];
    };

    // assert
    expect(res.status).toBe(200);
    expect(body.from).toBeNull();
    expect(body.to.commitId).toBe(to);
    for (const file of body.files) expect(file.status).toBe("added");
  });

  test("reports an empty request as 400", async () => {
    // arrange
    // act
    const res = await handleInterdiff(request({}));
    const body = (await res.json()) as { error: string };

    // assert
    expect(res.status).toBe(400);
    expect(body.error).toMatch(/from or a to/);
  });

  test("reports an unresolvable commit as 400 with jj's message", async () => {
    // arrange
    // act
    const res = await handleInterdiff(
      request({ from: "no-such-xyz", to: "@" }),
    );
    const body = (await res.json()) as { error: string };

    // assert
    expect(res.status).toBe(400);
    expect(body.error).toMatch(/doesn't exist/);
  });
});
// ~/~ end
