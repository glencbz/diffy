// ~/~ begin <<docs/architecture/backend/local-reviews.md#backend-local-reviews>>[init]
import {
  type LocalVersion,
  localReview,
  type ReviewDocument,
} from "../../frontend/model/review";
import { type GitCommit, GitOid } from "../commit/git";
import {
  type JjFileDiff,
  jjCommits,
  jjDiff,
  jjInterdiff,
  jjLog,
  jjOpLog,
} from "../commit/jj";

/** What a caller asked to register. Anything left out takes its default. */
export interface Registration {
  name?: string;
  revset?: string;
  operation?: string;
}

/** A registration the caller cannot make without saying more. */
export class RegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegistrationError";
  }
}

async function bookmarkBelowWorkingCopy(
  root: string,
  operation: string,
): Promise<string | null> {
  const [entry] = await jjLog(root, {
    revset: "heads(::@ & bookmarks())",
    atOperation: operation,
    limit: 1,
  });
  const bookmark = entry?.refs.find(
    (ref) => ref.kind === "bookmark" && !ref.name.includes("@"),
  );
  return bookmark?.name ?? null;
}

/** The registration `asked` stands for, with each default filled in, or
 *  null where the repository cannot supply one. */
export async function registrationDefaults(
  root: string,
  document: ReviewDocument,
  asked: Registration,
): Promise<{ name: string | null; revset: string | null; operation: string }> {
  const [current] = await jjOpLog(root, { limit: 1 });
  if (current === undefined) throw new Error("jj reported no operations");
  const operation = asked.operation ?? current.id;
  const bookmark = await bookmarkBelowWorkingCopy(root, operation);
  const name = asked.name ?? bookmark;
  const last =
    name === null ? undefined : localReview(document, name)?.versions.at(-1);
  const revset =
    asked.revset ??
    last?.revset ??
    // Quoted, since a bookmark name can hold what a bare symbol cannot.
    (name === null ? null : `trunk()..${JSON.stringify(name)}`);
  return { name, revset, operation };
}

/** The version `asked` registers, under the name it goes by. */
export async function resolveRegistration(
  root: string,
  document: ReviewDocument,
  asked: Registration,
  at: string,
): Promise<{ name: string; version: LocalVersion }> {
  const { name, revset, operation } = await registrationDefaults(
    root,
    document,
    asked,
  );
  if (name === null || revset === null) {
    throw new RegistrationError(
      "no bookmark sits at or below the working copy, so give the review a name and a revset",
    );
  }
  const commits = await jjLog(root, { revset, atOperation: operation });
  if (commits.length === 0) {
    throw new RegistrationError(`${revset} names no commits`);
  }
  return {
    name,
    version: {
      operation,
      revset,
      commits: commits.map((commit) => commit.commitId).reverse(),
      registeredAt: at,
    },
  };
}

/** The commits `ids` name, in that order, in a pull request's shape. */
export async function localCommits(
  root: string,
  ids: string[],
): Promise<GitCommit[]> {
  const found = await jjCommits(root, ids);
  return ids.flatMap((id) => {
    const entry = found.get(id);
    if (entry === undefined) return [];
    return [
      {
        commitId: GitOid.parse(entry.commitId),
        parents: entry.parents.map((parent) => GitOid.parse(parent)),
        description: entry.description,
        author: entry.author,
        authoredAt: entry.timestamp,
        changeId: entry.changeId,
      },
    ];
  });
}

/** One row's comparison: the interdiff of two commits, or one commit's own
 *  diff. */
export function localDiff(
  root: string,
  from: string | null,
  to: string | null,
): Promise<JjFileDiff[]> {
  if (from !== null && to !== null) return jjInterdiff(root, { from, to });
  const lone = from ?? to;
  return lone === null ? Promise.resolve([]) : jjDiff(root, { revision: lone });
}

/** A whole version against what it was built on: one diff from the parents
 *  of its roots to its heads. jj refuses a set with a gap in it, and the
 *  screen shows that error in place of a size. */
export function localSize(root: string, ids: string[]): Promise<JjFileDiff[]> {
  return jjDiff(root, { revision: ids.join("|") });
}
// ~/~ end
