// ~/~ begin <<docs/architecture/frontend/transport.md#frontend-model-pull>>[init]
import type { FileDiff } from "./diff";
import type { GitCommit, GitOid } from "./history";

export type PullCommitsResponse = {
  head: GitOid;
  version: number;
  base: GitOid;
  commits: GitCommit[];
};
// ~/~ end
// ~/~ begin <<docs/architecture/frontend/transport.md#frontend-model-pull>>[1]

export type PullState = "OPEN" | "CLOSED" | "MERGED";

export type PullSummary = {
  number: number;
  title: string;
  state: PullState;
  author: string;
  updatedAt: string;
  headRefOid: GitOid;
  baseRefName: string;
  url: string;
};

/** How a head became the head. Only a force push has a time to show. */
export type PullHeadOrigin =
  | { kind: "opened" }
  | { kind: "force-pushed"; at: string }
  | { kind: "current" };

export type PullVersion = {
  /** Position in the chain. A label to show, never a way to ask for a state. */
  version: number;
  head: GitOid;
  origin: PullHeadOrigin;
};

export type PullHistory = {
  number: number;
  baseRefName: string;
  baseRefOid: GitOid;
  /** Oldest first. The last one is the head the branch has now. */
  states: PullVersion[];
  truncated: boolean;
};

/** What the after side is measured against. */
export type PullBaseline = { kind: "base" } | { kind: "version"; head: GitOid };

/** What to diff inside the heads `from`/`to` resolve: both whole heads, one
 *  commit, or the pair across two versions. */
export type PullDiffScope =
  | { kind: "heads" }
  | { kind: "commit"; commit: GitOid }
  | { kind: "pair"; from: GitOid; to: GitOid };

export type PullDiffResponse = {
  from: PullBaseline;
  to: GitOid;
  files: FileDiff[];
};
// ~/~ end
