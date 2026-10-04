// ~/~ begin <<docs/architecture/frontend/transport.md#frontend-model-history>>[init]
import * as z from "zod";

/** A full 40-hex git object id. Branded: only a parse mints one. */
export type GitOid = string & z.$brand<"GitOid">;
export const GitOid = z
  .string()
  .regex(/^[0-9a-f]{40}$/, "expected a full 40-character git object id")
  .brand("GitOid");

/** A name a backend prints beside a commit: see `CommitRef` in the jj module. */
export type CommitRef = {
  kind: "bookmark" | "tag" | "working-copy";
  name: string;
};

export type CommitMarker =
  | "working-copy"
  | "empty"
  | "conflict"
  | "divergent"
  | "hidden";

export type LogEntry = {
  commitId: string;
  changeId: string | null;
  description: string;
  parents: string[];
  /** Whoever the backend names as the author, as it names them. */
  author: string;
  /** ISO 8601. The instant the backend dates this commit by. */
  timestamp: string;
  refs: CommitRef[];
  markers: CommitMarker[];
};

export type OpLogEntry = {
  id: string;
  description: string;
  time: string;
  args: string;
};
// ~/~ end
// ~/~ begin <<docs/architecture/frontend/transport.md#frontend-model-history>>[1]

/** A view of the local repo: the jj operation to read its log at. */
export type JjSource = { kind: "jj"; operation: string | null };

/** One head a pull request has had, named by oid because versions shift. */
export type PullSource = {
  kind: "pull";
  repo: string;
  number: number;
  head: GitOid;
};

/** One version of a local review, named by the commits it registered. */
export type LocalSource = { kind: "local"; commits: string[] };

/** Where one side's commits come from. */
export type Source = JjSource | PullSource | LocalSource;

export type GitCommit = {
  commitId: GitOid;
  parents: GitOid[];
  description: string;
  author: string;
  authoredAt: string;
  /** What lines this commit up against another across a force push. The
   *  backend derives it from the subject line, since git records nothing
   *  durable of its own. */
  changeId: string | null;
};
// ~/~ end
