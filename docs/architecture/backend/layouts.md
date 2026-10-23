# Layout store

The reader's [panel layouts](../frontend/panels.md#the-layout-tree) live in
`layouts.json` in the [host's](host.md) data directory, beside the
[recent list](repos.md#the-recent-list), so every browser and every
repository opens the screen the way the reader left it. They belong to the
reader rather than a repository, so the per-repository
[review store](review-store.md) is the wrong home for them, and a browser's
own storage would leave a second browser with the defaults.

The browser sends the whole document on every change. It is a few
kilobytes, written when the reader moves a panel, so a command per move
would buy nothing; two browsers writing at once keep the later one. A file
that does not parse reads as the defaults rather than stopping the screen.

```ts
//| id: backend-layouts
//| file: src/backend/layouts/layouts.ts
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import * as z from "zod";
import { DEFAULT_LAYOUTS, LayoutsDocument } from "../../frontend/model/panels";

export class LayoutStore {
  constructor(private readonly path: string) {}

  static in(dataDir: string): LayoutStore {
    return new LayoutStore(join(dataDir, "layouts.json"));
  }

  async read(): Promise<LayoutsDocument> {
    const file = Bun.file(this.path);
    if (!(await file.exists())) return DEFAULT_LAYOUTS;
    const parsed = LayoutsDocument.safeParse(
      await file.json().catch(() => null),
    );
    return parsed.success ? parsed.data : DEFAULT_LAYOUTS;
  }

  async write(document: LayoutsDocument): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await Bun.write(this.path, JSON.stringify(document, null, 2));
  }
}

export function layoutRoutes(store: LayoutStore) {
  return {
    "/api/layouts": {
      GET: async () => Response.json(await store.read()),
      PUT: async (req: Request) => {
        const body = LayoutsDocument.safeParse(
          await req.json().catch(() => null),
        );
        if (!body.success) {
          return Response.json(
            { error: z.prettifyError(body.error) },
            { status: 400 },
          );
        }
        await store.write(body.data);
        return Response.json(body.data);
      },
    },
  };
}
```

## Tests

```ts
//| id: backend-layouts-test
//| file: src/backend/layouts/layouts.test.ts
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
```
