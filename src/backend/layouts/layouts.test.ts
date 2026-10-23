// ~/~ begin <<docs/architecture/backend/layouts.md#backend-layouts-test>>[init]
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_LAYOUTS } from "../../frontend/model/panels";
import { LayoutStore, layoutRoutes } from "./layouts";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "diffy-layouts-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("layout store", () => {
  test("reads the defaults before anything is written", async () => {
    // arrange
    const store = LayoutStore.in(dir);

    // act
    const read = await store.read();

    // assert
    expect(read).toEqual(DEFAULT_LAYOUTS);
  });

  test("keeps what a browser puts", async () => {
    // arrange
    const route = layoutRoutes(LayoutStore.in(dir))["/api/layouts"];
    const document = { current: "columns", edited: {} };

    // act
    const put = await route.PUT(
      new Request("http://test/api/layouts", {
        method: "PUT",
        body: JSON.stringify(document),
      }),
    );
    const read = await (await route.GET()).json();

    // assert
    expect(put.status).toBe(200);
    expect(read).toEqual(document);
  });

  test("refuses a layout that is not a tree", async () => {
    // arrange
    const route = layoutRoutes(LayoutStore.in(dir))["/api/layouts"];

    // act
    const put = await route.PUT(
      new Request("http://test/api/layouts", {
        method: "PUT",
        body: JSON.stringify({ current: "x", edited: { x: { kind: "box" } } }),
      }),
    );

    // assert
    expect(put.status).toBe(400);
    expect(await LayoutStore.in(dir).read()).toEqual(DEFAULT_LAYOUTS);
  });

  test("a file that does not parse reads as the defaults", async () => {
    // arrange
    await Bun.write(join(dir, "layouts.json"), "{ not json");

    // act
    const read = await LayoutStore.in(dir).read();

    // assert
    expect(read).toEqual(DEFAULT_LAYOUTS);
  });
});
// ~/~ end
