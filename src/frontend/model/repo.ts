// ~/~ begin <<docs/architecture/frontend/repos.md#frontend-model-repo>>[init]
export interface ServedRepo {
  home: string;
  /** The workspace root being served, or null before the reader picks one. */
  current: string | null;
  /** Where the run started, while diffy serves a recent repository instead. */
  startedOutside: string | null;
}

export interface RepoSummary {
  root: string;
  workingCopy: string;
  reviews: number;
  openedAt: string | null;
}

export interface FoundRepo {
  root: string;
  kind: "jj" | "git";
}

export interface RecentEntry {
  root: string;
  openedAt: string;
}

export type RepoProbe =
  | { kind: "jj" | "git"; root: string }
  | { kind: "none" }
  | { kind: "checking" };

export function tildePath(path: string, home: string): string {
  if (path === home) return "~";
  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

/** A path's last folder and the folders above it, as the picker draws them. */
export function pathParts(path: string): { name: string; parent: string } {
  const cut = path.lastIndexOf("/");
  if (cut < 0) return { name: path, parent: "" };
  if (cut === 0) return { name: path.slice(1), parent: "/" };
  return { name: path.slice(cut + 1), parent: path.slice(0, cut) };
}

export function isPathQuery(query: string): boolean {
  return /^[~/.]/.test(query.trim());
}

export function matchesQuery(
  root: string,
  home: string,
  query: string,
): boolean {
  const asked = query.trim().toLowerCase();
  return asked === "" || tildePath(root, home).toLowerCase().includes(asked);
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function since(at: string, now: number): string {
  const elapsed = now - Date.parse(at);
  if (elapsed < MINUTE) return "just now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m ago`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h ago`;
  if (elapsed < 30 * DAY) return `${Math.floor(elapsed / DAY)}d ago`;
  return `${Math.floor(elapsed / (30 * DAY))}mo ago`;
}
// ~/~ end
