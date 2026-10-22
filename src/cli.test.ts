// ~/~ begin <<docs/architecture/backend/cli.md#cli-test>>[init]
import { expect, test } from "bun:test";
import { type Command, parseCommand } from "./cli";

test("no port means this user's server, opened in the browser", () => {
  expect(parseCommand([])).toEqual({
    kind: "serve",
    port: { kind: "sticky" },
    open: true,
  });
  expect(parseCommand(["--no-open"])).toEqual({
    kind: "serve",
    port: { kind: "sticky" },
    open: false,
  });
});

test("a port given long or short is held to", () => {
  const given: Command = {
    kind: "serve",
    port: { kind: "given", port: 4100 },
    open: true,
  };
  expect(parseCommand(["--port", "4100"])).toEqual(given);
  expect(parseCommand(["-p", "4100"])).toEqual(given);
});

test("a port that is not one is a usage error", () => {
  for (const port of ["abc", "0", "65536", "80.5"]) {
    expect(parseCommand(["--port", port]).kind).toBe("usage-error");
  }
});

test("a path names the repository to serve", () => {
  expect(parseCommand(["~/src/a", "-p", "4100"])).toEqual({
    kind: "serve",
    path: "~/src/a",
    port: { kind: "given", port: 4100 },
    open: true,
  });
});

test("unknown flags and a second path are usage errors", () => {
  expect(parseCommand(["--bogus"]).kind).toBe("usage-error");
  expect(parseCommand(["a", "b"]).kind).toBe("usage-error");
});

test("difft takes exactly two directories", () => {
  expect(parseCommand(["difft", "a", "b"])).toEqual({
    kind: "difft",
    left: "a",
    right: "b",
  });
  expect(parseCommand(["difft", "a"]).kind).toBe("usage-error");
  expect(parseCommand(["difft", "a", "b", "c"]).kind).toBe("usage-error");
});

test("mcp takes an optional server URL", () => {
  expect(parseCommand(["mcp"])).toEqual({ kind: "mcp" });
  expect(parseCommand(["mcp", "--url", "http://localhost:4000"])).toEqual({
    kind: "mcp",
    url: "http://localhost:4000",
  });
  expect(parseCommand(["mcp", "--url", "nope"]).kind).toBe("usage-error");
  expect(parseCommand(["mcp", "--port", "1"]).kind).toBe("usage-error");
});

test("wait takes one review and an optional server URL", () => {
  expect(parseCommand(["wait", "t"])).toEqual({ kind: "wait", review: "t" });
  expect(parseCommand(["wait", "t", "--url", "http://localhost:4000"])).toEqual(
    { kind: "wait", review: "t", url: "http://localhost:4000" },
  );
  expect(parseCommand(["wait"]).kind).toBe("usage-error");
  expect(parseCommand(["wait", "t", "u"]).kind).toBe("usage-error");
  expect(parseCommand(["wait", "t", "--url", "nope"]).kind).toBe("usage-error");
});

test("--help asks for the usage", () => {
  expect(parseCommand(["--help"])).toEqual({ kind: "help" });
});
// ~/~ end
