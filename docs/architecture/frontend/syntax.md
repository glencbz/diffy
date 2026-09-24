# Syntax colours

A diff line is coloured by the language it is written in, over the green or
red that says whether it was added or removed. The server
[highlights whole files](../backend/syntax.md), because a hunk on its own
cannot be highlighted correctly, and the diff view picks each line it draws
out of the side of the file that line belongs to.

## Loading each side

`useSources` is handed the files a screen is showing and loads both sides of
each, keyed by blob and path. It answers with a lookup rather than the map
itself, so a view asks for the side it needs by the names a file diff already
carries and never learns how the answers are stored.

A side that has not arrived, or that failed, is simply absent, and the view
draws that side's lines uncoloured. Colour is an improvement on a diff that
already reads correctly, so a missing side is not worth a loading state or an
error message, and the one side jj never writes down, an interdiff's
rebased before side, costs the reader nothing but its colours.

Each side is asked for once for the life of the hook, whichever files asked
for it, since a blob's contents never change. The effect depends on the JSON
of the sides it wants, the same way `useComparison` depends on its question's,
because the list of files is a fresh array whenever its screen renders.

```ts
//| id: frontend-state-source
//| file: src/frontend/state/source.ts
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
```

## Colours

A token's kind picks a role, and the roles live with the rest of the palette
in [Design tokens](tokens.md), so dark mode recolours code the way it
recolours everything else. A token with no kind is in the default foreground
and gets no class at all.

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
