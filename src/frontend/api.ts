// ~/~ begin <<docs/architecture/frontend.md#frontend-api>>[init]
import * as z from "zod";

export const LogEntry = z.object({
  commitId: z.string(),
  changeId: z.string(),
  description: z.string(),
  parents: z.array(z.string()),
});
export type LogEntry = z.infer<typeof LogEntry>;

const LogResponse = z.array(LogEntry);

const fileDiffFields = {
  binary: z.boolean(),
  patch: z.string(),
};

export const FileDiff = z.discriminatedUnion("status", [
  z.object({ status: z.literal("added"), path: z.string(), ...fileDiffFields }),
  z.object({
    status: z.literal("deleted"),
    path: z.string(),
    ...fileDiffFields,
  }),
  z.object({
    status: z.literal("modified"),
    path: z.string(),
    ...fileDiffFields,
  }),
  z.object({
    status: z.literal("renamed"),
    oldPath: z.string(),
    newPath: z.string(),
    ...fileDiffFields,
  }),
  z.object({
    status: z.literal("copied"),
    oldPath: z.string(),
    newPath: z.string(),
    ...fileDiffFields,
  }),
]);
export type FileDiff = z.infer<typeof FileDiff>;

const DiffResponse = z.object({
  revision: z.string(),
  files: z.array(FileDiff),
});
export type DiffResponse = z.infer<typeof DiffResponse>;

const ErrorResponse = z.object({ error: z.string() });

export async function fetchLog(): Promise<LogEntry[]> {
  const res = await fetch("/api/log");
  if (!res.ok) throw new Error(`GET /api/log failed (${res.status})`);
  return LogResponse.parse(await res.json());
}

export async function fetchDiff(revision: string): Promise<DiffResponse> {
  const res = await fetch(`/api/diff?rev=${encodeURIComponent(revision)}`);
  const body: unknown = await res.json();

  if (!res.ok) {
    const parsed = ErrorResponse.safeParse(body);
    throw new Error(
      parsed.success
        ? parsed.data.error
        : `GET /api/diff failed (${res.status})`,
    );
  }

  return DiffResponse.parse(body);
}
// ~/~ end
