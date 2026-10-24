// ~/~ begin <<docs/architecture/backend/evidence.md#frontend-model-evidence>>[init]
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
// ~/~ end
