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

export const OpLogEntry = z.object({
  id: z.string(),
  description: z.string(),
  time: z.string(),
  args: z.string(),
});
export type OpLogEntry = z.infer<typeof OpLogEntry>;

const OpLogResponse = z.array(OpLogEntry);

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

export const InterdiffRow = z.object({
  from: LogEntry.nullable(),
  to: LogEntry.nullable(),
  files: z.array(FileDiff),
});
export type InterdiffRow = z.infer<typeof InterdiffRow>;

const InterdiffResponse = z.object({ rows: z.array(InterdiffRow) });
export type InterdiffResponse = z.infer<typeof InterdiffResponse>;

const ErrorResponse = z.object({ error: z.string() });

/** GET a jj-backed endpoint, turning a 400 into its `error` message. */
async function getJson(url: string, label: string): Promise<unknown> {
  const res = await fetch(url);
  const body: unknown = await res.json();

  if (!res.ok) {
    const parsed = ErrorResponse.safeParse(body);
    throw new Error(
      parsed.success ? parsed.data.error : `${label} failed (${res.status})`,
    );
  }

  return body;
}

export async function fetchOperations(): Promise<OpLogEntry[]> {
  return OpLogResponse.parse(
    await getJson("/api/operations", "GET /api/operations"),
  );
}

export async function fetchLog(atOperation?: string): Promise<LogEntry[]> {
  const query = atOperation ? `?op=${encodeURIComponent(atOperation)}` : "";
  return LogResponse.parse(await getJson(`/api/log${query}`, "GET /api/log"));
}

export async function fetchDiff(
  revision: string,
  atOperation?: string,
): Promise<DiffResponse> {
  const params = new URLSearchParams({ rev: revision });
  if (atOperation) params.set("op", atOperation);
  return DiffResponse.parse(
    await getJson(`/api/diff?${params}`, "GET /api/diff"),
  );
}

export async function fetchInterdiff(
  from: string[],
  to: string[],
): Promise<InterdiffResponse> {
  const params = new URLSearchParams();
  for (const commitId of from) params.append("from", commitId);
  for (const commitId of to) params.append("to", commitId);
  return InterdiffResponse.parse(
    await getJson(`/api/interdiff?${params}`, "GET /api/interdiff"),
  );
}
// ~/~ end
// ~/~ begin <<docs/architecture/frontend.md#frontend-api>>[1]

const Comparison = z.object({
  changeId: z.string(),
  fromCommitId: z.string().nullable(),
  toCommitId: z.string().nullable(),
});

export const Mark = Comparison.extend({ seenAt: z.string() });
export type Mark = z.infer<typeof Mark>;

export const Comment = z.object({
  id: z.string(),
  changeId: z.string(),
  path: z.string(),
  line: z.number().int(),
  commitId: z.string(),
  body: z.string(),
  resolved: z.boolean(),
  createdAt: z.string(),
});
export type Comment = z.infer<typeof Comment>;

export const SessionDocument = z.object({
  marks: z.array(Mark),
  comments: z.array(Comment),
});
export type SessionDocument = z.infer<typeof SessionDocument>;

export const SessionEdit = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("mark"), ...Mark.shape }),
  z.object({ kind: z.literal("unmark"), ...Comparison.shape }),
  z.object({ kind: z.literal("comment"), comment: Comment }),
  z.object({
    kind: z.literal("resolveComment"),
    id: z.string(),
    resolved: z.boolean(),
  }),
  z.object({ kind: z.literal("dropComment"), id: z.string() }),
]);
export type SessionEdit = z.infer<typeof SessionEdit>;

/** POST a JSON body, turning a non-ok response into its `error` message. */
async function postJson(
  url: string,
  body: unknown,
  label: string,
): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.ok) return;

  const parsed = ErrorResponse.safeParse(await res.json());
  throw new Error(
    parsed.success ? parsed.data.error : `${label} failed (${res.status})`,
  );
}

export async function fetchSession(): Promise<SessionDocument> {
  return SessionDocument.parse(
    await getJson("/api/session", "GET /api/session"),
  );
}

export async function postSessionEdit(edit: SessionEdit): Promise<void> {
  return postJson("/api/session", edit, "POST /api/session");
}
// ~/~ end
