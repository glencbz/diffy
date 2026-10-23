// ~/~ begin <<docs/architecture/backend/evidence.md#backend-evidence-store>>[init]
import { mkdir } from "node:fs/promises";
import { extname, join } from "node:path";
import { BlobName } from "../../frontend/model/evidence";

/** The largest file a capture may be. A minute of screen video at the
 *  sizes a review shows is a few megabytes. */
export const LARGEST = 64 * 1024 * 1024;

export class EvidenceStore {
  constructor(private readonly dir: string) {}

  static in(dataDir: string): EvidenceStore {
    return new EvidenceStore(join(dataDir, "evidence"));
  }

  /** Copies the file at `path` in, answering its name, or why not. */
  async put(path: string): Promise<{ name: BlobName } | { refused: string }> {
    const source = Bun.file(path);
    if (!(await source.exists())) return { refused: `there is no ${path}` };
    if (source.size > LARGEST) {
      return { refused: `${path} is over ${LARGEST / 1024 / 1024} MB` };
    }
    const bytes = await source.bytes();
    const hash = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
    const name = BlobName.safeParse(`${hash}${extname(path).toLowerCase()}`);
    if (!name.success) {
      return {
        refused: `${path} is not a picture or a clip diffy shows (png, jpg, webp, gif, mp4, webm)`,
      };
    }
    const kept = Bun.file(join(this.dir, name.data));
    if (!(await kept.exists())) {
      await mkdir(this.dir, { recursive: true });
      await Bun.write(kept, bytes);
    }
    return { name: name.data };
  }

  file(name: BlobName): Bun.BunFile {
    return Bun.file(join(this.dir, name));
  }
}

export function evidenceRoutes(store: EvidenceStore) {
  return {
    "/api/evidence/:name": async (
      req: Request & { params: { name: string } },
    ) => {
      const name = BlobName.safeParse(req.params.name);
      if (!name.success) return new Response("Not found", { status: 404 });
      const file = store.file(name.data);
      if (!(await file.exists())) {
        return new Response("Not found", { status: 404 });
      }
      // Its name is its content, so it never changes.
      const headers = {
        "Accept-Ranges": "bytes",
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Type": file.type,
      };
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("Range") ?? "");
      if (range === null) return new Response(file, { headers });
      const size = file.size;
      const start =
        range[1] === ""
          ? Math.max(0, size - Number(range[2]))
          : Number(range[1]);
      const end =
        range[1] !== "" && range[2] !== ""
          ? Math.min(Number(range[2]), size - 1)
          : size - 1;
      if (start > end || start >= size) {
        return new Response(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${size}` },
        });
      }
      return new Response(file.slice(start, end + 1), {
        status: 206,
        headers: {
          ...headers,
          "Content-Range": `bytes ${start}-${end}/${size}`,
          "Content-Length": String(end - start + 1),
        },
      });
    },
  };
}
// ~/~ end
