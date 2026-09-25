# Transport

`api.ts` is the only module that talks to the backend, and the only one that
knows a server exists.

`api.ts` has one Zod schema and one `fetch` wrapper per endpoint. `JjFileDiff`
is a discriminated union on `status`. `added`, `deleted`, and `modified` carry
a single `path`. `renamed` and `copied` carry `oldPath` and `newPath`.

`LogEntry.changeId` is nullable because a GitHub pull request's commits are
plain git commits, and a git commit has no change id. The field stays
required, so a backend without one has to say `changeId: null`. Defaulting a
missing key to null reads as more forgiving and costs more than it gives. A
jj backend that stopped emitting `change_id` through a bug of its own would
parse cleanly, and every row would quietly lose its rewrite-stable identity
with nothing raised to say why. A missing field is a backend nobody taught
about this one, and it should fail at the boundary.
[`alignSeries`](../backend/series.md) has what pairing does without an id.

`LogEntry` carries the rest of what a log row shows: who wrote the commit,
when, the names pointing at it and the standings a backend reports about it.
`author` and `timestamp` are display strings whose precision is the backend's
to choose, because the two backends disagree on which one a reader wants. jj
prints an author's email and a committer's timestamp, and matching `jj log`
is the point; a GitHub pull request is read through git, which knows an
author's name and the date they wrote. `refs` and `markers` are empty for a
git commit, which has neither in this app.

`GitOid` is branded, so the only way to hold one is to have parsed it out of a
backend response. A head oid cannot be typed into the app by hand, which is
what makes the guarantee in the next section hold at compile time.

```ts
//| id: frontend-api
//| file: src/frontend/api.ts
import * as z from "zod";

/** A full 40-hex git object id. Branded: only a parsed response mints one. */
export const GitOid = z
  .string()
  .regex(/^[0-9a-f]{40}$/, "expected a full 40-character git object id")
  .brand("GitOid");
export type GitOid = z.infer<typeof GitOid>;

/** A name a backend prints beside a commit: see `CommitRef` in the jj module. */
export const CommitRef = z.object({
  kind: z.enum(["bookmark", "tag", "working-copy"]),
  name: z.string(),
});
export type CommitRef = z.infer<typeof CommitRef>;

export const CommitMarker = z.enum([
  "working-copy",
  "empty",
  "conflict",
  "divergent",
  "hidden",
]);
export type CommitMarker = z.infer<typeof CommitMarker>;

export const LogEntry = z.object({
  commitId: z.string(),
  changeId: z.string().nullable(),
  description: z.string(),
  parents: z.array(z.string()),
  /** Whoever the backend names as the author, as it names them. */
  author: z.string(),
  /** ISO 8601. The instant the backend dates this commit by. */
  timestamp: z.string(),
  refs: z.array(CommitRef),
  markers: z.array(CommitMarker),
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

/** A token difftastic says changed, in UTF-16 code units of its line. */
const ChangedRange = z.object({ start: z.number(), end: z.number() });

/** A file as [difftastic](../backend/difft.md) reads it: hunks in the same
 *  shape a patch reads into, with each changed line's ranges, or why the
 *  file has none. */
export const StructuralDiff = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("structural"),
    language: z.string(),
    hunks: z.array(
      z.object({
        header: z.string(),
        newStart: z.number(),
        lines: z.array(
          z.discriminatedUnion("kind", [
            z.object({
              kind: z.literal("context"),
              code: z.string(),
              newLine: z.number(),
            }),
            z.object({
              kind: z.literal("removed"),
              code: z.string(),
              oldLine: z.number(),
              changes: z.array(ChangedRange),
            }),
            z.object({
              kind: z.literal("added"),
              code: z.string(),
              newLine: z.number(),
              changes: z.array(ChangedRange),
            }),
          ]),
        ),
      }),
    ),
  }),
  z.object({ kind: z.literal("unavailable"), reason: z.string() }),
]);
export type StructuralDiff = z.infer<typeof StructuralDiff>;

const fileDiffFields = {
  binary: z.boolean(),
  /** The blob each side is stored under, for `fetchSource`. Null for a side
   *  that does not exist. */
  oldBlob: z.string().nullable(),
  newBlob: z.string().nullable(),
  patch: z.string(),
  structural: StructuralDiff,
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
```

## Where a side's commits come from

A side of the comparison is a list of commits, and there is more than one place
those commits can come from. A jj operation gives the local repo as it stood
after that step. A head of a pull request gives a branch on GitHub as it stood
before somebody force-pushed over it. `Source` is that choice, a tagged union
rather than an operation with a pull request hanging off it, so a side is
always exactly one of the two and no view has to ask which.

A pull request head is named by its object id and never by the version number
the picker shows. A version is a position in a chain that shifts, so `v7` can
come to mean a different commit while the page is open; the backend's
`pullStateAt` has the full account. Holding the oid makes "show me version 7 of
a pull request that now has three versions" a request nobody can express.

```ts
//| id: frontend-api

/** A view of the local repo: the jj operation to read its log at. */
export type JjSource = { kind: "jj"; operation: string | null };

/** One head a pull request has had, named by oid because versions shift. */
export type PullSource = {
  kind: "pull";
  repo: string;
  number: number;
  head: GitOid;
};

/** Where one side's commits come from. */
export type Source = JjSource | PullSource;

export const GitCommit = z.object({
  commitId: GitOid,
  parents: z.array(GitOid),
  description: z.string(),
  author: z.string(),
  authoredAt: z.string(),
  /** What lines this commit up against another across a force push. The
   *  backend derives it from the subject line, since git records nothing
   *  durable of its own. */
  changeId: z.string().nullable(),
});
export type GitCommit = z.infer<typeof GitCommit>;

const PullCommitsResponse = z.object({
  head: GitOid,
  version: z.number(),
  base: GitOid,
  commits: z.array(GitCommit),
});
export type PullCommitsResponse = z.infer<typeof PullCommitsResponse>;

export async function fetchPullCommits(
  repo: string,
  number: number,
  head: GitOid,
): Promise<PullCommitsResponse> {
  const params = new URLSearchParams({ repo, number: String(number), head });
  return PullCommitsResponse.parse(
    await getJson(
      `/api/github/pull/commits?${params}`,
      "GET /api/github/pull/commits",
    ),
  );
}
```

## Reading a pull request

The pull request screen calls its endpoints in the order the reader moves
through them: the repository's pull requests, then one pull request's chain of
heads, then the diff at or between those heads.

`fetchPullDiff` needs both ends, and the two ends are not the same kind of
thing. `to` is always a head. `from` is a `PullBaseline`, either another head
of the pull request or the branch it targets, and which one it is decides the
comparison the route runs. The [route's own doc](../backend/server.md) has
both comparisons and why each end takes what it takes.

A baseline travels as one parameter, the literal `base` or a 40-hex oid.
Nothing that is 40 hex characters reads as `base`, so the two cannot collide
and the route parses the choice out of the value itself.

```ts
//| id: frontend-api

export const PullState = z.enum(["OPEN", "CLOSED", "MERGED"]);
export type PullState = z.infer<typeof PullState>;

export const PullSummary = z.object({
  number: z.number(),
  title: z.string(),
  state: PullState,
  author: z.string(),
  updatedAt: z.string(),
  headRefOid: GitOid,
  baseRefName: z.string(),
  url: z.string(),
});
export type PullSummary = z.infer<typeof PullSummary>;

const PullsResponse = z.array(PullSummary);

/** How a head became the head. Only a force push has a time to show. */
export const PullHeadOrigin = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("opened") }),
  z.object({ kind: z.literal("force-pushed"), at: z.string() }),
  z.object({ kind: z.literal("current") }),
]);
export type PullHeadOrigin = z.infer<typeof PullHeadOrigin>;

export const PullVersion = z.object({
  /** Position in the chain. A label to show, never a way to ask for a state. */
  version: z.number(),
  head: GitOid,
  origin: PullHeadOrigin,
});
export type PullVersion = z.infer<typeof PullVersion>;

export const PullHistory = z.object({
  number: z.number(),
  baseRefName: z.string(),
  baseRefOid: GitOid,
  /** Oldest first. The last one is the head the branch has now. */
  states: z.array(PullVersion),
  truncated: z.boolean(),
});
export type PullHistory = z.infer<typeof PullHistory>;

/** What the after side is measured against. */
export const PullBaseline = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("base") }),
  z.object({ kind: z.literal("version"), head: GitOid }),
]);
export type PullBaseline = z.infer<typeof PullBaseline>;

const PullDiffResponse = z.object({
  from: PullBaseline,
  to: GitOid,
  files: z.array(FileDiff),
});
export type PullDiffResponse = z.infer<typeof PullDiffResponse>;

export async function fetchPulls(
  repo: string,
  state: "open" | "closed" | "merged" | "all",
): Promise<PullSummary[]> {
  const params = new URLSearchParams({ repo, state });
  return PullsResponse.parse(
    await getJson(`/api/github/pulls?${params}`, "GET /api/github/pulls"),
  );
}

export async function fetchPullHistory(
  repo: string,
  number: number,
): Promise<PullHistory> {
  const params = new URLSearchParams({ repo, number: String(number) });
  return PullHistory.parse(
    await getJson(
      `/api/github/pull/history?${params}`,
      "GET /api/github/pull/history",
    ),
  );
}

/** The one commit, or the pair across two versions, to diff inside the heads
 *  `from`/`to` resolve. The backend's `DiffScope` also has a whole-head
 *  shape, which no screen asks for. */
export type PullDiffScope =
  | { kind: "commit"; commit: GitOid }
  | { kind: "pair"; from: GitOid; to: GitOid };

export async function fetchPullDiff(
  repo: string,
  number: number,
  to: GitOid,
  from: PullBaseline,
  scope: PullDiffScope,
): Promise<PullDiffResponse> {
  const params = new URLSearchParams({
    repo,
    number: String(number),
    to,
    from: from.kind === "base" ? "base" : from.head,
  });
  if (scope.kind === "pair") {
    params.set("fromCommit", scope.from);
    params.set("toCommit", scope.to);
  } else {
    params.set("toCommit", scope.commit);
  }
  return PullDiffResponse.parse(
    await getJson(
      `/api/github/pull/diff?${params}`,
      "GET /api/github/pull/diff",
    ),
  );
}
```

## Reading a file's source

A file diff names the blob behind each side, and `/api/source` answers one of
them whole, [a line at a time and highlighted](../backend/syntax.md). The
path goes with the blob because the path is what says which language to
highlight it as.

```ts
//| id: frontend-api

export const SyntaxKind = z.enum([
  "keyword",
  "string",
  "string-expression",
  "comment",
  "constant",
  "function",
  "parameter",
  "punctuation",
  "link",
]);
export type SyntaxKind = z.infer<typeof SyntaxKind>;

export const SyntaxToken = z.object({
  text: z.string(),
  kind: SyntaxKind.nullable(),
});
export type SyntaxToken = z.infer<typeof SyntaxToken>;

export const SourceFile = z.object({
  language: z.string().nullable(),
  lines: z.array(z.array(SyntaxToken)),
});
export type SourceFile = z.infer<typeof SourceFile>;

export async function fetchSource(
  blob: string,
  path: string,
): Promise<SourceFile> {
  const params = new URLSearchParams({ blob, path });
  return SourceFile.parse(
    await getJson(`/api/source?${params}`, "GET /api/source"),
  );
}
```

## Showing a file rendered

An image is shown from a URL rather than fetched as data, so the browser
decodes it the way it decodes any image, and `blobUrl` only builds that URL
for [`/api/blob`](../backend/server.md#serving-a-file-as-it-is). A Markdown
side comes back from `/api/markdown` as
[HTML the server has already made safe](../backend/markdown.md).

```ts
//| id: frontend-api

export function blobUrl(blob: string, path: string): string {
  return `/api/blob?${new URLSearchParams({ blob, path })}`;
}

const RenderedMarkdown = z.object({ html: z.string() });

export async function fetchMarkdown(blob: string): Promise<string> {
  const params = new URLSearchParams({ blob });
  return RenderedMarkdown.parse(
    await getJson(`/api/markdown?${params}`, "GET /api/markdown"),
  ).html;
}
```
