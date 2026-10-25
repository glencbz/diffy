// ~/~ begin <<docs/architecture/backend/evidence.md#backend-evidence-test>>[init]
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EvidenceStore, evidenceRoutes } from "./store";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "diffy-evidence-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const ask = (store: EvidenceStore, name: string, range?: string) =>
  evidenceRoutes(store)["/api/evidence/:name"](
    Object.assign(
      new Request(`http://test/api/evidence/${name}`, {
        headers: range === undefined ? {} : { Range: range },
      }),
      { params: { name } },
    ),
  );

describe("evidence store", () => {
  test("keeps a file once, under its content", async () => {
    // arrange
    const store = EvidenceStore.in(join(dir, "data"));
    await Bun.write(join(dir, "a.png"), "picture");
    await Bun.write(join(dir, "b.png"), "picture");

    // act
    const a = await store.put(join(dir, "a.png"));
    const b = await store.put(join(dir, "b.png"));

    // assert
    expect(a).toEqual(b);
    expect("name" in a && a.name.endsWith(".png")).toBe(true);
  });

  test("refuses what it cannot show", async () => {
    // arrange
    const store = EvidenceStore.in(dir);
    await Bun.write(join(dir, "notes.txt"), "words");

    // act
    const text = await store.put(join(dir, "notes.txt"));
    const gone = await store.put(join(dir, "gone.png"));

    // assert
    expect("refused" in text).toBe(true);
    expect(gone).toEqual({ refused: `there is no ${join(dir, "gone.png")}` });
  });

  test("answers a range, so a clip can seek", async () => {
    // arrange
    const store = EvidenceStore.in(dir);
    await Bun.write(join(dir, "clip.mp4"), "0123456789");
    const put = await store.put(join(dir, "clip.mp4"));
    if (!("name" in put)) throw new Error("not stored");

    // act
    const whole = await ask(store, put.name);
    const part = await ask(store, put.name, "bytes=2-5");

    // assert
    expect(await whole.text()).toBe("0123456789");
    expect(part.status).toBe(206);
    expect(part.headers.get("Content-Range")).toBe("bytes 2-5/10");
    expect(await part.text()).toBe("2345");
  });

  test("answers nothing for a name that is not a stored file", async () => {
    // arrange
    const store = EvidenceStore.in(dir);

    // act
    const traversal = await ask(store, "..%2Fsecret.png");
    const missing = await ask(store, `${"0".repeat(64)}.png`);

    // assert
    expect(traversal.status).toBe(404);
    expect(missing.status).toBe(404);
  });
});
// ~/~ end
