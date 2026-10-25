# Evidence

What an author recorded to show a change working: for now, captures, a
screenshot or a clip of the app at a commit and at its parent. An agent
attaches them with the [evidence tools](#the-tools), the
[review document](../frontend/review.md#review-state) keeps what each one
is and which components it shows, and the files themselves sit in the
[host's](host.md) data directory. The [panels](../frontend/panels.md)
roadmap adds runs, whose steps are evidence of another kind.

## A capture

A capture belongs to one commit of one version, as a
[component map](../frontend/components.md#the-component-map) does, and keeps
its id from version to version so two versions' captures of the same thing
can be compared. Each side names a file by its content's hash; a side is
null when that commit has nothing to show, such as the parent of a commit
that adds the page.

What a capture shows is said by component: a box on the picture, a span of
the clip, or both. A box is kept as fractions of the picture, so it lands in
the same place however large the picture is drawn; the agent measures it in
the page's own pixels and names the page's size. Keeping the shows on the
capture rather than on the component lets an agent rewrite the map without
losing its captures, and the other way round.

```ts
//| id: frontend-model-evidence
//| file: src/frontend/model/evidence.ts
import * as z from "zod";

/** A file the evidence store holds: its content's hash and extension. */
export const BlobName = z
  .string()
  .regex(/^[0-9a-f]{64}\.(png|jpg|jpeg|webp|gif|mp4|webm)$/);
export type BlobName = z.infer<typeof BlobName>;

/** Left, top, width and height, each a fraction of the picture. */
export const Box = z.tuple([
  z.number().min(0).max(1),
  z.number().min(0).max(1),
  z.number().min(0).max(1),
  z.number().min(0).max(1),
]);
export type Box = z.infer<typeof Box>;

/** Where a capture shows one component. */
export const Shown = z.object({
  component: z.string().min(1),
  box: Box.optional(),
  /** Seconds into a clip, from and to. */
  at: z.tuple([z.number().min(0), z.number().min(0)]).optional(),
  about: z.string().default(""),
});
export type Shown = z.infer<typeof Shown>;

export const Capture = z.object({
  series: z.string(),
  version: z.string(),
  commitId: z.string(),
  /** The same in every version that has it. */
  id: z.string().min(1),
  name: z.string().min(1),
  /** The state of the app it shows, a word or two each: "dark", "phone". */
  state: z.array(z.string()).default([]),
  about: z.string().default(""),
  media: z.enum(["image", "video"]),
  /** At the commit's parent. */
  before: BlobName.nullable(),
  /** At the commit. */
  after: BlobName.nullable(),
  shows: z.array(Shown).default([]),
  attachedAt: z.string(),
});
export type Capture = z.infer<typeof Capture>;

const sameCapture = (a: Capture, b: Capture) =>
  a.series === b.series &&
  a.version === b.version &&
  a.commitId === b.commitId &&
  a.id === b.id;

/** `captures` with `capture` in place of any of its commit's with its id. */
export function withCapture(captures: Capture[], capture: Capture): Capture[] {
  return [...captures.filter((each) => !sameCapture(each, capture)), capture];
}

/** The captures of one version of a series, in the order they came. */
export function capturesOf(
  captures: Capture[],
  series: string,
  version: string,
): Capture[] {
  return captures.filter(
    (each) => each.series === series && each.version === version,
  );
}

/** Where the browser reads a stored file. */
export function blobUrl(name: BlobName): string {
  return `/api/evidence/${name}`;
}
```

## Storing the files

A file is stored once under the hash of what it holds, so a capture
attached again with the same picture costs nothing, and a reader's link
never shows a file that changed under it. The name keeps the extension so
the server can say what the file is without reading it.

An agent names a file by its path on the same machine; the store copies it
in, so the agent can delete its own copy. A file the agent wrote somewhere
diffy cannot read is refused with the path, rather than stored empty.

The route answers a byte range when asked, since a browser seeks in a clip
by asking for the part it needs, and `Bun.file` sends whole files.

```ts
//| id: backend-evidence-store
//| file: src/backend/evidence/store.ts
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
```

## The tools

An agent attaches a capture to the newest version of a review, as it writes
that version's [component map](agents.md#the-component-tools), and after
the map, since what a capture shows is said by the map's component ids. A
component the map lacks is refused, with the ids it has, rather than drawn
as a box that leads nowhere. Attaching a capture with an id the commit
already has replaces it, so an agent corrects a capture by attaching it
again.

The agent measures boxes the way a browser driver gives them, in the page's
pixels, and names the page's size; the tool turns them into fractions. A box
reaching off the page is refused, since it usually means the size given is
not the size measured in.

```ts
//| id: backend-agent-evidence
//| file: src/backend/agent/evidence.ts
import * as z from "zod";
import { componentsTo } from "../../frontend/model/components";
import {
  type Box,
  type Capture,
  capturesOf,
  type Shown,
} from "../../frontend/model/evidence";
import type { EvidenceStore } from "../evidence/store";
import type { RepoContext } from "../repo/repos";
import { type Tool, type ToolContext, ToolError, tool } from "./mcp";
import {
  commitNamed,
  liveSources,
  type SeriesSources,
  short,
  Target,
  targetOf,
} from "./series";

const ShownInput = z.object({
  component: z
    .string()
    .min(1)
    .describe("the id of a component of the commit's map"),
  box: z
    .object({
      x: z.number(),
      y: z.number(),
      width: z.number().positive(),
      height: z.number().positive(),
    })
    .optional()
    .describe(
      "where on the capture the component draws, in the page's pixels, as a browser driver measures an element",
    ),
  at: z
    .object({ start: z.number().min(0), end: z.number().min(0) })
    .optional()
    .describe("for a clip, the seconds in which it shows the component"),
  about: z
    .string()
    .default("")
    .describe("what to look for there, in a few words"),
});

/** Why a box cannot be drawn on a page of `size`, or its fractions. */
function boxOf(
  box: { x: number; y: number; width: number; height: number },
  size: { width: number; height: number },
  component: string,
): Box {
  const slack = 1;
  if (
    box.x < -slack ||
    box.y < -slack ||
    box.x + box.width > size.width + slack ||
    box.y + box.height > size.height + slack
  ) {
    throw new ToolError(
      `${component}'s box reaches off a ${size.width}×${size.height} page; measure boxes in the page's own pixels and give the size they were measured in`,
    );
  }
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  return [
    clamp(box.x / size.width),
    clamp(box.y / size.height),
    clamp(box.width / size.width),
    clamp(box.height / size.height),
  ];
}

/** What an agent gives to attach a capture: the files it took, or that
 *  diffy took for it while [recording](recording.md). */
export const AttachInput = z.object({
  ...Target,
  commit: z
    .string()
    .min(1)
    .describe("the change id or commit id it shows, or a prefix"),
  id: z
    .string()
    .min(1)
    .describe(
      "a short slug, the same in every version that captures the same thing",
    ),
  name: z
    .string()
    .min(1)
    .describe("what it shows, such as the page's name: Settings"),
  state: z
    .array(z.string())
    .default([])
    .describe(
      "the state of the app, a word or two each, such as dark or phone",
    ),
  about: z.string().default("").describe("what to look for, a sentence"),
  after: z
    .string()
    .min(1)
    .optional()
    .describe(
      "the path on this machine of the picture or clip taken at the commit",
    ),
  before: z
    .string()
    .min(1)
    .optional()
    .describe(
      "the path of the same taken at the commit's parent, if it can be shown there",
    ),
  size: z
    .object({
      width: z.number().positive(),
      height: z.number().positive(),
    })
    .describe("the page's size in the pixels the boxes are measured in"),
  shows: z.array(ShownInput).default([]),
});
export type AttachInput = z.infer<typeof AttachInput>;

/** Attaches a capture and says where it went. */
export async function attachCapture(
  input: AttachInput,
  { repo, link, now }: ToolContext,
  store: EvidenceStore,
  sources: SeriesSources,
): Promise<string> {
  if (input.after === undefined && input.before === undefined) {
    throw new ToolError("give the capture at the commit, its parent, or both");
  }
  const target = await targetOf(sources, input);
  const commit = commitNamed(target, input.commit);
  const map = componentsTo(
    repo.store.read().document.componentMaps,
    target.series,
    target.version,
  );
  const ids = (map?.components ?? [])
    .filter((each) => each.commitId === commit.commitId)
    .map((each) => each.id);
  const stray = input.shows.find((each) => !ids.includes(each.component));
  if (stray !== undefined) {
    throw new ToolError(
      ids.length === 0
        ? `${short(commit)} has no components in ${target.label}'s map; write the map first`
        : `${stray.component} is not a component of ${short(commit)}; its components are ${ids.join(", ")}`,
    );
  }
  const shows = input.shows.map(
    (each): Shown => ({
      component: each.component,
      about: each.about,
      ...(each.box === undefined
        ? {}
        : { box: boxOf(each.box, input.size, each.component) }),
      ...(each.at === undefined
        ? {}
        : { at: [each.at.start, Math.max(each.at.start, each.at.end)] }),
    }),
  );
  const stored = async (path: string | undefined) => {
    if (path === undefined) return null;
    const put = await store.put(path);
    if ("refused" in put) throw new ToolError(put.refused);
    return put.name;
  };
  const before = await stored(input.before);
  const after = await stored(input.after);
  const video = [before, after].some(
    (name) => name !== null && /\.(mp4|webm)$/.test(name),
  );
  const capture: Capture = {
    series: target.series,
    version: target.version,
    commitId: commit.commitId,
    id: input.id,
    name: input.name,
    state: input.state,
    about: input.about,
    media: video ? "video" : "image",
    before,
    after,
    shows,
    attachedAt: now().toISOString(),
  };
  repo.store.apply({ kind: "attach-capture", capture });
  return [
    link(target.path),
    `${input.id} is attached to ${short(commit)} in ${target.label}, showing ${shows.length === 0 ? "no component" : shows.map((each) => each.component).join(", ")}`,
  ].join("\n");
}

export function evidenceTools(
  store: EvidenceStore,
  sourcesOf: (repo: RepoContext) => SeriesSources = liveSources,
): Tool[] {
  return [
    tool({
      name: "attach_capture",
      description:
        "Attach a screenshot or a clip of the app to a commit of the newest version of a local review or a pull request: the app at the commit, and at its parent where it can be shown, with where it shows each of the commit's components. Write the version's component map first; a capture names its components by their ids. Attaching an id the commit already has replaces it.",
      input: AttachInput,
      call: (input, context) =>
        attachCapture(input, context, store, sourcesOf(context.repo)),
    }),
    tool({
      name: "read_captures",
      description:
        "Read the captures attached to the newest version of a local review or a pull request, as JSON, with what each shows.",
      input: z.object({ ...Target }),
      call: async (input, { repo }) => {
        const target = await targetOf(sourcesOf(repo), input);
        const names = new Map(
          target.commits.map((commit) => [commit.commitId, short(commit)]),
        );
        const captures = capturesOf(
          repo.store.read().document.captures,
          target.series,
          target.version,
        );
        if (captures.length === 0) return `${target.label} has no captures yet`;
        return JSON.stringify(
          captures.map(({ series, version, commitId, ...rest }) => ({
            commit: names.get(commitId) ?? commitId,
            ...rest,
          })),
          null,
          2,
        );
      },
    }),
    tool({
      name: "detach_capture",
      description:
        "Take a capture off a commit of the newest version of a local review or a pull request.",
      input: z.object({
        ...Target,
        commit: z
          .string()
          .min(1)
          .describe("the change id or commit id, or a prefix"),
        id: z.string().min(1).describe("the capture's id"),
      }),
      call: async (input, { repo }) => {
        const target = await targetOf(sourcesOf(repo), input);
        const commit = commitNamed(target, input.commit);
        const had = capturesOf(
          repo.store.read().document.captures,
          target.series,
          target.version,
        ).some(
          (each) => each.commitId === commit.commitId && each.id === input.id,
        );
        if (!had) {
          throw new ToolError(`${short(commit)} has no capture ${input.id}`);
        }
        repo.store.apply({
          kind: "detach-capture",
          series: target.series,
          version: target.version,
          commitId: commit.commitId,
          id: input.id,
        });
        return `${input.id} is off ${short(commit)}`;
      },
    }),
  ];
}
```

## Tests

```ts
//| id: backend-evidence-test
//| file: src/backend/evidence/store.test.ts
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
```

```ts
//| id: backend-agent-evidence-test
//| file: src/backend/agent/evidence.test.ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { capturesOf } from "../../frontend/model/evidence";
import { EvidenceStore } from "../evidence/store";
import { openReviewStore, type ReviewStore } from "../review/store";
import { evidenceTools } from "./evidence";
import { mcpRoute } from "./mcp";
import { INSTRUCTIONS } from "./review";
import type { SeriesSources } from "./series";

let dir: string;
let store: ReviewStore;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "diffy-evidence-tools-"));
  store = openReviewStore(join(dir, "r.sqlite"));
  await Bun.write(join(dir, "after.png"), "after");
  store.apply({
    kind: "write-components",
    map: {
      series: "pull:o/r#7",
      version: "h".repeat(40),
      author: "claude",
      writtenAt: "t",
      components: [
        {
          commitId: "aaaa1111",
          id: "header",
          kind: "styles",
          name: "header",
          role: "implements",
          gist: "",
          words: [],
          mentions: [],
          places: [{ path: "a.css", side: "after", start: 1, about: "" }],
        },
      ],
      groups: [],
    },
  });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const PULL: SeriesSources = {
  local: () => Promise.reject(new Error("not asked")),
  pull: async (number) => ({
    series: `pull:o/r#${number}`,
    version: "h".repeat(40),
    label: "v2",
    path: `/pulls/${number}`,
    commits: [
      {
        commitId: "aaaa1111",
        changeId: null,
        subject: "dark header",
        description: "dark header",
      },
    ],
  }),
  diff: async () => [],
  files: async () => [],
};

async function call(
  name: string,
  args: Record<string, unknown>,
): Promise<{ text: string; isError: boolean }> {
  const route = mcpRoute(
    evidenceTools(EvidenceStore.in(join(dir, "data")), () => PULL),
    INSTRUCTIONS,
    async () => ({
      repo: { root: "/repo", store, topic: "t" },
      link: (path) => `https://vm:4000${path}`,
      wait: (name) => `diffy wait ${name}`,
      now: () => new Date("2026-10-23T00:00:00Z"),
    }),
  );
  const res = await route.POST(
    new Request("http://localhost/mcp", {
      method: "POST",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    }),
  );
  const body = (await res.json()) as {
    result: { content: { text: string }[]; isError?: boolean };
  };
  return {
    text: body.result.content[0]?.text ?? "",
    isError: body.result.isError ?? false,
  };
}

const CAPTURE = {
  pull: 7,
  commit: "aaaa",
  id: "settings",
  name: "Settings",
  state: ["dark"],
  size: { width: 800, height: 600 },
};

describe("the evidence tools", () => {
  test("attach a capture, its boxes as fractions of the page", async () => {
    // arrange
    const shows = [
      {
        component: "header",
        box: { x: 0, y: 0, width: 800, height: 60 },
      },
    ];

    // act
    const answer = await call("attach_capture", {
      ...CAPTURE,
      after: join(dir, "after.png"),
      shows,
    });

    // assert
    expect(answer.isError).toBe(false);
    const [capture] = capturesOf(
      store.read().document.captures,
      "pull:o/r#7",
      "h".repeat(40),
    );
    expect(capture?.before).toBeNull();
    expect(capture?.media).toBe("image");
    expect(capture?.shows[0]?.box).toEqual([0, 0, 1, 0.1]);
  });

  test("refuse a component the commit's map lacks", async () => {
    // arrange
    const shows = [{ component: "footer" }];

    // act
    const answer = await call("attach_capture", {
      ...CAPTURE,
      after: join(dir, "after.png"),
      shows,
    });

    // assert
    expect(answer.isError).toBe(true);
    expect(answer.text).toContain("its components are header");
  });

  test("refuse a box measured on another page", async () => {
    // arrange
    const shows = [
      { component: "header", box: { x: 0, y: 0, width: 1600, height: 60 } },
    ];

    // act
    const answer = await call("attach_capture", {
      ...CAPTURE,
      after: join(dir, "after.png"),
      shows,
    });

    // assert
    expect(answer.isError).toBe(true);
    expect(answer.text).toContain("reaches off a 800×600 page");
  });

  test("attaching the same id again replaces it, and detaching takes it off", async () => {
    // arrange
    await call("attach_capture", { ...CAPTURE, after: join(dir, "after.png") });
    await call("attach_capture", {
      ...CAPTURE,
      name: "Settings again",
      after: join(dir, "after.png"),
    });
    const kept = () =>
      capturesOf(store.read().document.captures, "pull:o/r#7", "h".repeat(40));
    const replaced = kept().map((each) => each.name);

    // act
    const answer = await call("detach_capture", {
      pull: 7,
      commit: "aaaa",
      id: "settings",
    });

    // assert
    expect(replaced).toEqual(["Settings again"]);
    expect(answer.isError).toBe(false);
    expect(kept()).toEqual([]);
  });
});
```
