// ~/~ begin <<docs/architecture/backend/layouts.md#backend-layouts>>[init]
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
// ~/~ end
