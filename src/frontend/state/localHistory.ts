// ~/~ begin <<docs/architecture/frontend/local-history.md#frontend-state-local-history>>[init]
import { useEffect, useRef, useState } from "react";
import { fetchOperations } from "../api";
import { type LocalHistory, pick, withOperations } from "../model/localHistory";

const POLL_INTERVAL_MS = 2000;

type LocalSideName = "before" | "after";

export function useLocalHistory() {
  const [history, setHistory] = useState<LocalHistory>({ status: "loading" });
  const polling = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      if (polling.current) return;
      polling.current = true;
      try {
        const operations = await fetchOperations();
        if (!cancelled) {
          setHistory((current) => withOperations(current, operations));
        }
      } catch (err) {
        if (!cancelled) {
          setHistory((current) =>
            current.status === "loading"
              ? { status: "error", message: String(err) }
              : current,
          );
        }
      } finally {
        polling.current = false;
      }
    }

    void poll();
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") void poll();
    }, POLL_INTERVAL_MS);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void poll();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  function pickOperation(side: LocalSideName, operationId: string | null) {
    setHistory((current) => {
      if (current.status !== "ready") return current;
      const head = current.operations[0];
      if (head === undefined) return current;
      const next = { pick: pick(head.id, operationId), commits: [] };
      return side === "before"
        ? { ...current, before: next }
        : { ...current, after: next };
    });
  }

  function selectCommits(side: LocalSideName, commitIds: string[]) {
    setHistory((current) => {
      if (current.status !== "ready") return current;
      return side === "before"
        ? { ...current, before: { ...current.before, commits: commitIds } }
        : { ...current, after: { ...current.after, commits: commitIds } };
    });
  }

  return { history, pickOperation, selectCommits };
}
// ~/~ end
