// ~/~ begin <<docs/architecture/frontend/local-reviews.md#frontend-model-revset>>[init]
import type { LogEntry } from "./history";

function localBookmark(commit: LogEntry): string | undefined {
  return commit.refs.find(
    (ref) => ref.kind === "bookmark" && !ref.name.includes("@"),
  )?.name;
}

/** How a revset names `commit`. */
function symbol(commit: LogEntry): string {
  const bookmark = localBookmark(commit);
  if (bookmark !== undefined) return JSON.stringify(bookmark);
  if (commit.changeId === null || commit.markers.includes("divergent")) {
    return commit.commitId.slice(0, 12);
  }
  return commit.changeId.slice(0, 12);
}

/** The commits of `log` that `from` reaches through parents, itself
 *  included. */
function ancestors(log: Map<string, LogEntry>, from: string): Set<string> {
  const seen = new Set<string>();
  const stack = [from];
  for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
    const commit = log.get(id);
    if (commit === undefined || seen.has(id)) continue;
    seen.add(id);
    stack.push(...commit.parents);
  }
  return seen;
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  return a.size === b.size && [...a].every((id) => b.has(id));
}

/** A revset naming exactly the commits `ticked` holds, or "" for none.
 *  `trunk` is the commit id `trunk()` names, if known. */
export function revsetFor(
  log: LogEntry[],
  ticked: string[],
  trunk: string | null,
): string {
  const byId = new Map(log.map((commit) => [commit.commitId, commit]));
  const chosen = new Set(ticked.filter((id) => byId.has(id)));
  const picked = log.filter((commit) => chosen.has(commit.commitId));
  if (picked.length === 0) return "";

  const parentsOf = (commit: LogEntry) =>
    commit.parents.filter((id) => chosen.has(id));
  const heads = picked.filter(
    (commit) =>
      !picked.some((other) => parentsOf(other).includes(commit.commitId)),
  );
  const roots = picked.filter((commit) => parentsOf(commit).length === 0);
  const [head] = heads;

  if (heads.length === 1 && head !== undefined) {
    const reach = ancestors(byId, head.commitId);
    if (trunk !== null && !chosen.has(trunk)) {
      const below = ancestors(byId, trunk);
      const stack = new Set([...reach].filter((id) => !below.has(id)));
      if (sameSet(stack, chosen)) return `trunk()..${symbol(head)}`;
    }

    const [root] = roots;
    if (roots.length === 1 && root !== undefined) {
      const run = new Set(
        [...reach].filter((id) => ancestors(byId, id).has(root.commitId)),
      );
      if (sameSet(run, chosen)) {
        return root === head
          ? symbol(head)
          : `${symbol(root)}::${symbol(head)}`;
      }
    }
  }

  return picked.map(symbol).join(" | ");
}

/** What to call a review of `ticked` until the reader says: the one head's
 *  bookmark, else its change id, else nothing. */
export function reviewNameFor(log: LogEntry[], ticked: string[]): string {
  const chosen = new Set(ticked);
  const picked = log.filter((commit) => chosen.has(commit.commitId));
  const heads = picked.filter(
    (commit) =>
      !picked.some((other) => other.parents.includes(commit.commitId)),
  );
  const [head] = heads;
  if (heads.length !== 1 || head === undefined) return "";
  return localBookmark(head) ?? head.changeId?.slice(0, 8) ?? "";
}
// ~/~ end
