// ~/~ begin <<docs/architecture/frontend/syntax.md#frontend-state-source>>[init]
import { useCallback, useEffect, useRef, useState } from "react";
import { type FileDiff, fetchSource, type SourceFile } from "../api";

/** One side of a file, whole and highlighted, or null while there is none. */
export type SourceLookup = (blob: string, path: string) => SourceFile | null;

interface Side {
  blob: string;
  path: string;
}

function sideKey({ blob, path }: Side): string {
  return `${blob}:${path}`;
}

/** The sides of `files` there is something to load for. */
function sidesOf(files: FileDiff[]): Side[] {
  return files.flatMap((file) => {
    if (file.binary) return [];
    const oldPath = "path" in file ? file.path : file.oldPath;
    const newPath = "path" in file ? file.path : file.newPath;
    return [
      ...(file.oldBlob === null ? [] : [{ blob: file.oldBlob, path: oldPath }]),
      ...(file.newBlob === null ? [] : [{ blob: file.newBlob, path: newPath }]),
    ];
  });
}

export function useSources(files: FileDiff[]): SourceLookup {
  const [loaded, setLoaded] = useState<ReadonlyMap<string, SourceFile>>(
    () => new Map(),
  );
  const asked = useRef(new Set<string>());
  const wanted = JSON.stringify(sidesOf(files));

  useEffect(() => {
    for (const side of JSON.parse(wanted) as Side[]) {
      const key = sideKey(side);
      if (asked.current.has(key)) continue;
      asked.current.add(key);

      fetchSource(side.blob, side.path).then(
        (source) => setLoaded((now) => new Map(now).set(key, source)),
        () => {},
      );
    }
  }, [wanted]);

  return useCallback(
    (blob, path) => loaded.get(sideKey({ blob, path })) ?? null,
    [loaded],
  );
}
// ~/~ end
