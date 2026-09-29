// ~/~ begin <<docs/architecture/frontend/local-history.md#frontend-model-local-history-test>>[init]
import { describe, expect, test } from "bun:test";
import type { OpLogEntry } from "../api";
import {
  newerOperation,
  pick,
  pickerValue,
  withOperations,
} from "./localHistory";

function op(id: string): OpLogEntry {
  return {
    id,
    description: `op ${id}`,
    time: "2024-01-01T00:00:00Z",
    args: "jj",
  };
}

describe("withOperations", () => {
  test("the first load puts both sides at the newest operation, latest", () => {
    const history = withOperations({ status: "loading" }, [op("b"), op("a")]);

    expect(history).toEqual({
      status: "ready",
      operations: [op("b"), op("a")],
      before: { pick: { kind: "latest", at: "b" }, commits: [] },
      after: { pick: { kind: "latest", at: "b" }, commits: [] },
    });
  });

  test("a later poll with a new head keeps both sides where they were", () => {
    const first = withOperations({ status: "loading" }, [op("a")]);
    const polled = withOperations(first, [op("b"), op("a")]);

    expect(polled).toMatchObject({
      before: { pick: { kind: "latest", at: "a" } },
      after: { pick: { kind: "latest", at: "a" } },
    });
  });

  test("an unchanged poll returns the same object", () => {
    const first = withOperations({ status: "loading" }, [op("a")]);
    const polled = withOperations(first, [op("a")]);

    expect(polled).toBe(first);
  });
});

describe("newerOperation", () => {
  test("reports the newest operation for a latest side that fell behind", () => {
    const first = withOperations({ status: "loading" }, [op("a")]);
    const polled = withOperations(first, [op("b"), op("a")]);
    if (polled.status !== "ready") throw new Error("expected ready");

    expect(newerOperation(polled.after, polled.operations)).toEqual(op("b"));
  });

  test("says nothing for a side pinned to a specific operation", () => {
    const first = withOperations({ status: "loading" }, [op("a")]);
    if (first.status !== "ready") throw new Error("expected ready");
    const pinned = { ...first, after: { pick: pick("a", "a"), commits: [] } };
    const polled = withOperations(pinned, [op("b"), op("a")]);
    if (polled.status !== "ready") throw new Error("expected ready");

    expect(newerOperation(polled.after, polled.operations)).toBeNull();
  });
});

describe("pick", () => {
  test("null takes the current head as latest", () => {
    expect(pick("a", null)).toEqual({ kind: "latest", at: "a" });
  });

  test("an id pins to that operation", () => {
    expect(pick("a", "b")).toEqual({ kind: "pinned", at: "b" });
  });
});

describe("pickerValue", () => {
  test("is null only when latest and at the current head", () => {
    expect(pickerValue({ kind: "latest", at: "a" }, "a")).toBeNull();
    expect(pickerValue({ kind: "latest", at: "a" }, "b")).toBe("a");
    expect(pickerValue({ kind: "pinned", at: "a" }, "a")).toBe("a");
  });
});
// ~/~ end
