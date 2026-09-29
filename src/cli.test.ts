// ~/~ begin <<docs/architecture/backend/cli.md#cli-test>>[init]
import { expect, test } from "bun:test";
import { type Command, parseCommand } from "./cli";

test("no port means the first free one from 3000", () => {
  expect(parseCommand([])).toEqual({
    kind: "serve",
    port: { kind: "first-free", from: 3000 },
  });
});

test("a port given long or short is held to", () => {
  const given: Command = {
    kind: "serve",
    port: { kind: "given", port: 4100 },
  };
  expect(parseCommand(["--port", "4100"])).toEqual(given);
  expect(parseCommand(["-p", "4100"])).toEqual(given);
});

test("a port that is not one is a usage error", () => {
  for (const port of ["abc", "0", "65536", "80.5"]) {
    expect(parseCommand(["--port", port]).kind).toBe("usage-error");
  }
});

test("unknown flags and stray arguments are usage errors", () => {
  expect(parseCommand(["--bogus"]).kind).toBe("usage-error");
  expect(parseCommand(["somewhere"]).kind).toBe("usage-error");
});

test("--help asks for the usage", () => {
  expect(parseCommand(["--help"])).toEqual({ kind: "help" });
});
// ~/~ end
