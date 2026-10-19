// ~/~ begin <<docs/architecture/backend/instance.md#backend-instance-test>>[init]
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findServer, probe, rollPort, storedPort, storePort } from "./instance";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "diffy-instance-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("a stored port reads back, and a missing or bad file is none", async () => {
  const path = join(dir, "diffy", "server.json");
  expect(await storedPort(path)).toBeNull();
  await storePort(24817, path);
  expect(await storedPort(path)).toBe(24817);
  await Bun.write(path, "not json");
  expect(await storedPort(path)).toBeNull();
});

test("a rolled port stays below the ephemeral ranges", () => {
  expect(rollPort(() => 0)).toBe(20000);
  expect(rollPort(() => 0.999999)).toBe(32767);
});

test("only a server that says it is diffy is found", async () => {
  const diffy = Bun.serve({
    port: 0,
    fetch: () => Response.json({ diffy: 1, current: "/src/a", home: "/" }),
  });
  const other = Bun.serve({ port: 0, fetch: () => Response.json({}) });
  const portOf = (server: Bun.Server<undefined>) => Number(server.url.port);
  try {
    expect((await probe(portOf(diffy)))?.current).toBe("/src/a");
    expect(await probe(portOf(other))).toBeNull();

    const path = join(dir, "server.json");
    expect(await findServer(path)).toBeNull();
    await storePort(portOf(diffy), path);
    expect((await findServer(path))?.url.port).toBe(diffy.url.port);
  } finally {
    diffy.stop(true);
    other.stop(true);
  }
});
// ~/~ end
