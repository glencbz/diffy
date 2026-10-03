# Syntax colours

The server [highlights whole files](../backend/syntax.md), and the diff view
picks each line it draws out of its side's file.

## Loading each side

`useSources` loads both sides of every file on screen, keyed by blob and
path, and answers with a lookup. A side that has not arrived or failed is
absent and its lines draw uncoloured: colour improves a diff that already
reads, so it gets no loading or error state. That includes an interdiff's
before side, which jj never writes down.

```ts
//| id: frontend-model-source
//| file: src/frontend/model/source.ts
export type SyntaxKind =
  | "keyword"
  | "string"
  | "string-expression"
  | "comment"
  | "constant"
  | "function"
  | "parameter"
  | "punctuation"
  | "link";

export type SyntaxToken = { text: string; kind: SyntaxKind | null };

export type SourceFile = { language: string | null; lines: SyntaxToken[][] };

/** One side of a file, whole and highlighted, or null while there is none. */
export type SourceLookup = (blob: string, path: string) => SourceFile | null;
```

```ts
//| id: frontend-state-source
//| file: src/frontend/state/source.ts
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchSource } from "../api";
import type { FileDiff } from "../model/diff";
import type { SourceFile, SourceLookup } from "../model/source";

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
```

## Colours

A token's kind picks a role from [Design tokens](tokens.md). A token with no
kind gets no class.

```css
/*| id: design-syntax
@layer components {
  .syntax--keyword {
    color: var(--syntax-keyword);
  }

  .syntax--string,
  .syntax--string-expression {
    color: var(--syntax-string);
  }

  .syntax--comment {
    color: var(--syntax-comment);
  }

  .syntax--constant {
    color: var(--syntax-constant);
  }

  .syntax--function {
    color: var(--syntax-function);
  }

  .syntax--parameter {
    color: var(--syntax-parameter);
  }

  .syntax--punctuation {
    color: var(--syntax-punctuation);
  }

  .syntax--link {
    color: var(--syntax-link);
    text-decoration: underline;
  }
}
```
