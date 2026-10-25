// ~/~ begin <<docs/architecture/frontend/repos.md#frontend-state-repo>>[init]
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  fetchFoundRepos,
  fetchRecentRepos,
  fetchServedRepo,
  forgetRecentRepo,
  openRepo,
  probeRepoPath,
  restoreRecentRepo,
} from "../api";
import type { AsyncState } from "../model/asyncState";
import { readRepo, withRepo } from "../model/place";
import {
  type FoundRepo,
  isPathQuery,
  type RecentEntry,
  type RepoProbe,
  type RepoSummary,
  type ServedRepo,
} from "../model/repo";

export interface RepoHandle {
  served: AsyncState<ServedRepo>;
  /** Serve the repository at `path` and start over in it, or answer why not. */
  open: (path: string) => Promise<string | null>;
}

function failed(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useServedRepo(): RepoHandle {
  const [served, setServed] = useState<AsyncState<ServedRepo>>({
    status: "loading",
  });

  useEffect(() => {
    let cancelled = false;
    const named = readRepo(window.location);
    fetchServedRepo()
      .then(async ({ home, current }) => {
        if (named === null) {
          // Pin the tab, so a repository opened in another one leaves it be.
          if (current !== null) {
            const { pathname, search, hash } = window.location;
            history.replaceState(
              null,
              "",
              withRepo(`${pathname}${search}${hash}`, current),
            );
          }
          return { home, current };
        }
        // A repository the tab is opened on is the one used last, and one
        // that will not open leaves the tab asking for another.
        const opened = await openRepo(named).catch(() => null);
        return { home, current: opened };
      })
      .then(
        (data) => {
          if (!cancelled) setServed({ status: "ready", data });
        },
        (error) => {
          if (!cancelled)
            setServed({ status: "error", message: failed(error) });
        },
      );
    return () => {
      cancelled = true;
    };
  }, []);

  const open = useCallback(async (path: string) => {
    try {
      location.assign(withRepo("/", await openRepo(path)));
      return null;
    } catch (error) {
      return failed(error);
    }
  }, []);

  return useMemo(() => ({ served, open }), [served, open]);
}

export const RepoContext = createContext<RepoHandle | null>(null);

export function useRepoContext(): RepoHandle {
  const repo = useContext(RepoContext);
  if (repo === null) throw new Error("no RepoContext above this screen");
  return repo;
}

/** The workspace this tab reads, for a hook below the screens, which draw
 *  only once there is one. */
export function useWorkspace(): string {
  const { served } = useRepoContext();
  if (served.status !== "ready" || served.data.current === null) {
    throw new Error("no repository is open in this tab");
  }
  return served.data.current;
}
// ~/~ end
// ~/~ begin <<docs/architecture/frontend/repos.md#frontend-state-repo>>[1]

export interface RepoChoices {
  recent: AsyncState<RepoSummary[]>;
  found: AsyncState<FoundRepo[]>;
  /** The entry forgotten last, while it can still be put back. */
  forgotten: RecentEntry | null;
  forget: (root: string) => void;
  undo: () => void;
}

export function useRepoChoices(): RepoChoices {
  const [recent, setRecent] = useState<AsyncState<RepoSummary[]>>({
    status: "loading",
  });
  const [found, setFound] = useState<AsyncState<FoundRepo[]>>({
    status: "loading",
  });
  const [forgotten, setForgotten] = useState<RecentEntry | null>(null);

  const loadRecent = useCallback(
    () =>
      fetchRecentRepos().then(
        (data) => setRecent({ status: "ready", data }),
        (error) => setRecent({ status: "error", message: failed(error) }),
      ),
    [],
  );

  useEffect(() => {
    void loadRecent();
    fetchFoundRepos().then(
      (data) => setFound({ status: "ready", data }),
      (error) => setFound({ status: "error", message: failed(error) }),
    );
  }, [loadRecent]);

  const forget = useCallback((root: string) => {
    setRecent((now) =>
      now.status === "ready"
        ? { status: "ready", data: now.data.filter((r) => r.root !== root) }
        : now,
    );
    forgetRecentRepo(root).then(setForgotten, () => setForgotten(null));
  }, []);

  const undo = useCallback(() => {
    if (forgotten === null) return;
    setForgotten(null);
    void restoreRecentRepo(forgotten).then(loadRecent);
  }, [forgotten, loadRecent]);

  return { recent, found, forgotten, forget, undo };
}

const PROBE_AFTER_MS = 200;

export function useRepoProbe(query: string): RepoProbe | null {
  const path = isPathQuery(query) ? query.trim() : null;
  const [probe, setProbe] = useState<RepoProbe | null>(null);

  useEffect(() => {
    if (path === null) {
      setProbe(null);
      return;
    }
    setProbe({ kind: "checking" });
    let cancelled = false;
    const timer = setTimeout(() => {
      probeRepoPath(path).then(
        (answer) => {
          if (!cancelled) setProbe(answer);
        },
        () => {
          if (!cancelled) setProbe({ kind: "none" });
        },
      );
    }, PROBE_AFTER_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [path]);

  return probe;
}
// ~/~ end
