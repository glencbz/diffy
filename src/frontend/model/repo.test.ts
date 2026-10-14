// ~/~ begin <<docs/architecture/frontend/repos.md#frontend-model-repo-test>>[init]
import { describe, expect, test } from "bun:test";
import { isPathQuery, matchesQuery, pathParts, since, tildePath } from "./repo";

describe("tildePath", () => {
  test("writes the home directory as ~", () => {
    expect(tildePath("/home/me", "/home/me")).toBe("~");
    expect(tildePath("/home/me/src/a", "/home/me")).toBe("~/src/a");
    expect(tildePath("/home/meadow", "/home/me")).toBe("/home/meadow");
  });
});

describe("pathParts", () => {
  test("splits off the last folder", () => {
    expect(pathParts("~/src/a")).toEqual({ name: "a", parent: "~/src" });
    expect(pathParts("~")).toEqual({ name: "~", parent: "" });
    expect(pathParts("/a")).toEqual({ name: "a", parent: "/" });
  });
});

describe("the query", () => {
  test("is a path when it starts like one", () => {
    expect(isPathQuery("~/src")).toBe(true);
    expect(isPathQuery(" /srv")).toBe(true);
    expect(isPathQuery("src")).toBe(false);
  });

  test("matches the path as drawn, ignoring case", () => {
    expect(matchesQuery("/home/me/Work/api", "/home/me", "work/a")).toBe(true);
    expect(matchesQuery("/home/me/src/a", "/home/me", "work")).toBe(false);
    expect(matchesQuery("/home/me/src/a", "/home/me", "")).toBe(true);
  });
});

describe("since", () => {
  test("rounds down to the largest unit", () => {
    const now = Date.parse("2026-10-14T12:00:00Z");
    expect(since("2026-10-14T11:59:30Z", now)).toBe("just now");
    expect(since("2026-10-14T11:15:00Z", now)).toBe("45m ago");
    expect(since("2026-10-14T09:00:00Z", now)).toBe("3h ago");
    expect(since("2026-10-11T12:00:00Z", now)).toBe("3d ago");
    expect(since("2026-08-01T12:00:00Z", now)).toBe("2mo ago");
  });
});
// ~/~ end
