// ~/~ begin <<docs/architecture/frontend/diff.md#frontend-state-compared>>[init]
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchBeforePaths, fetchCompared } from "../api";
import type { AsyncState } from "../model/asyncState";
import {
  type BeforePaths,
  type CompareAsk,
  type ComparedLookup,
  compareKey,
} from "../model/compared";
import type { FileDiff } from "../model/diff";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useCompared(asks: CompareAsk[]): ComparedLookup {
  const [loaded, setLoaded] = useState<
    ReadonlyMap<string, AsyncState<FileDiff>>
  >(() => new Map());
  const asked = useRef(new Set<string>());
  const wanted = JSON.stringify(asks);

  useEffect(() => {
    for (const ask of JSON.parse(wanted) as CompareAsk[]) {
      const key = compareKey(ask);
      if (asked.current.has(key)) continue;
      asked.current.add(key);

      const put = (state: AsyncState<FileDiff>) =>
        setLoaded((now) => new Map(now).set(key, state));
      put({ status: "loading" });
      fetchCompared(ask).then(
        (file) => put({ status: "ready", data: file }),
        (error: unknown) => put({ status: "error", message: messageOf(error) }),
      );
    }
  }, [wanted]);

  return useCallback((ask) => loaded.get(compareKey(ask)) ?? null, [loaded]);
}

function keyOf(fromCommit: string | null, toCommit: string): string {
  return `${fromCommit ?? ""}:${toCommit}`;
}

export function useBeforePaths(): BeforePaths {
  const [loaded, setLoaded] = useState<
    ReadonlyMap<string, AsyncState<string[]>>
  >(() => new Map());
  const asked = useRef(new Set<string>());

  const want = useCallback((fromCommit: string | null, toCommit: string) => {
    const key = keyOf(fromCommit, toCommit);
    if (asked.current.has(key)) return;
    asked.current.add(key);

    const put = (state: AsyncState<string[]>) =>
      setLoaded((now) => new Map(now).set(key, state));
    put({ status: "loading" });
    fetchBeforePaths(fromCommit, toCommit).then(
      (paths) => put({ status: "ready", data: paths }),
      (error: unknown) => put({ status: "error", message: messageOf(error) }),
    );
  }, []);

  const get = useCallback(
    (fromCommit: string | null, toCommit: string) =>
      loaded.get(keyOf(fromCommit, toCommit)) ?? null,
    [loaded],
  );

  return { get, want };
}
// ~/~ end
