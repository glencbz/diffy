# Rendered files

A patch says how an image changed only as `Binary files differ`, and says
how a Markdown file or an SVG changed in source a reader has to picture. For
those files the diff view can show both sides as they are meant to be seen,
the before beside the after.

Which files that is follows from the path, since the path is all the view
has before it asks for anything. An image, SVG included, is drawn by the
browser from [its bytes](../backend/server.md#serving-a-file-as-it-is). A
Markdown file is [rendered by the server](../backend/markdown.md). A file
whose patch names neither side's blob, a pure rename, has nothing to show,
so it is not offered.

A binary image has no patch to read, so it is always shown rendered. An SVG
or a Markdown file is text and still has its patch, so its header offers
`rendered` beside the [diff views](diff.md#diff-view) and it starts in the
patch, where comments are.

```ts
//| id: frontend-view-rendered-file
//| file: src/frontend/views/RenderedFile.tsx
import { useEffect, useState } from "react";
import { blobUrl, type FileDiff, fetchMarkdown } from "../api";
import type { AsyncState } from "../state/asyncState";
import { afterPathOf } from "./changedFiles";

/** How a file's sides can be shown other than as a patch. */
export type Rendering = "image" | "markdown";

const RENDERINGS: Record<string, Rendering> = {
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  svg: "image",
  md: "markdown",
  markdown: "markdown",
};

/** How `file` can be shown rendered, or `null` when it cannot be. */
export function renderingOf(file: FileDiff): Rendering | null {
  if (file.oldBlob === null && file.newBlob === null) return null;
  const path = afterPathOf(file);
  const name = path.slice(path.lastIndexOf("/") + 1);
  if (!name.includes(".")) return null;
  return (
    RENDERINGS[name.slice(name.lastIndexOf(".") + 1).toLowerCase()] ?? null
  );
}
```

## Before and after

The two sides sit side by side where there is room for both at a readable
width, and one above the other where there is not, which on a phone is
always. A side the change has no file on, the before of an added file or the
after of a deleted one, says so in place, so an added image reads as a
change from nothing rather than as one lone picture.

An image is placed with `<img>` and never inline. An SVG is a document that
can carry script, and `<img>` is the one way to show it that never runs any.
An image sits on a checkerboard, so a transparent one shows where it is
transparent. A blob the object store does not hold, which an interdiff's
before side can be, fails to load, and the side says it could not be loaded
rather than showing a broken image.

A Markdown side is fetched when the side is drawn, so a file nobody switches
to rendered costs no request. Its HTML goes into the page as it came, because
the server already let nothing through but the parser's own markup and
allowlisted addresses.

```tsx
//| id: frontend-view-rendered-file

export function RenderedFile({
  file,
  rendering,
}: {
  file: FileDiff;
  rendering: Rendering;
}) {
  const oldPath = "path" in file ? file.path : file.oldPath;
  const newPath = "path" in file ? file.path : file.newPath;
  return (
    <div className="rendered-file">
      <RenderedSide
        label="before"
        blob={file.oldBlob}
        path={oldPath}
        rendering={rendering}
      />
      <RenderedSide
        label="after"
        blob={file.newBlob}
        path={newPath}
        rendering={rendering}
      />
    </div>
  );
}

function RenderedSide({
  label,
  blob,
  path,
  rendering,
}: {
  label: string;
  blob: string | null;
  path: string;
  rendering: Rendering;
}) {
  return (
    <figure className="rendered-file__side" aria-label={label}>
      <figcaption className="rendered-file__label">{label}</figcaption>
      {blob === null ? (
        <p className="rendered-file__note">No file on this side.</p>
      ) : rendering === "image" ? (
        <SideImage blob={blob} path={path} label={label} />
      ) : (
        <SideMarkdown blob={blob} />
      )}
    </figure>
  );
}

function SideImage({
  blob,
  path,
  label,
}: {
  blob: string;
  path: string;
  label: string;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <p className="rendered-file__note">This side could not be loaded.</p>
    );
  }
  return (
    <div className="rendered-file__canvas">
      <img
        className="rendered-file__image"
        src={blobUrl(blob, path)}
        alt={`${path}, ${label}`}
        onError={() => setFailed(true)}
      />
    </div>
  );
}

function SideMarkdown({ blob }: { blob: string }) {
  const [state, setState] = useState<AsyncState<string>>({
    status: "loading",
  });

  useEffect(() => {
    let live = true;
    setState({ status: "loading" });
    fetchMarkdown(blob).then(
      (html) => {
        if (live) setState({ status: "ready", data: html });
      },
      (err: unknown) => {
        if (live) setState({ status: "error", message: String(err) });
      },
    );
    return () => {
      live = false;
    };
  }, [blob]);

  if (state.status === "loading") {
    return <p className="rendered-file__note">Rendering...</p>;
  }
  if (state.status === "error") {
    return <p className="rendered-file__note">{state.message}</p>;
  }
  return (
    <div
      className="rendered-file__markdown"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: the server renders this with the author's own HTML off and addresses allowlisted
      dangerouslySetInnerHTML={{ __html: state.data }}
    />
  );
}
```

### Test

```ts
//| id: frontend-view-rendered-file-test
//| file: src/frontend/views/RenderedFile.test.ts
import { describe, expect, test } from "bun:test";
import type { FileDiff } from "../api";
import { renderingOf } from "./RenderedFile";

function file(path: string, blobs: Partial<FileDiff> = {}): FileDiff {
  return {
    status: "modified",
    path,
    binary: false,
    oldBlob: "a",
    newBlob: "b",
    patch: "",
    structural: { kind: "unavailable", reason: "test" },
    ...blobs,
  } as FileDiff;
}

describe("renderingOf", () => {
  test("shows images, SVG among them, as images", () => {
    // arrange
    // act
    // assert
    expect(renderingOf(file("logo.PNG"))).toBe("image");
    expect(renderingOf(file("icons/arrow.svg"))).toBe("image");
  });

  test("shows Markdown rendered", () => {
    // arrange
    // act
    // assert
    expect(renderingOf(file("docs/README.md"))).toBe("markdown");
  });

  test("offers nothing for other files, or for a side with no blob", () => {
    // arrange
    // act
    // assert
    expect(renderingOf(file("src/app.ts"))).toBeNull();
    expect(renderingOf(file("md"))).toBeNull();
    expect(
      renderingOf(file("logo.png", { oldBlob: null, newBlob: null })),
    ).toBeNull();
  });
});
```

## Look

```css
/*| id: design-diff-view
@layer components {
  .rendered-file {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 18rem), 1fr));
    gap: var(--space-4);
    padding: var(--space-4);
  }

  .rendered-file__side {
    min-width: 0;
    margin: 0;
  }

  .rendered-file__label {
    margin-bottom: var(--space-2);
    font-size: var(--text-size-small);
    color: var(--text-muted);
  }

  .rendered-file__canvas {
    display: flex;
    justify-content: center;
    padding: var(--space-3);
    border: 1px solid var(--border-subtle);
    background:
      repeating-conic-gradient(var(--surface-sunken) 0 25%, transparent 0 50%) 0
      0 / 16px 16px;
  }

  .rendered-file__image {
    display: block;
    max-width: 100%;
    height: auto;
  }

  .rendered-file__markdown {
    padding: 0 var(--space-4);
    border: 1px solid var(--border-subtle);
    overflow-wrap: anywhere;
  }

  .rendered-file__markdown :is(pre, table) {
    max-width: 100%;
    overflow-x: auto;
  }

  .rendered-file__markdown table {
    border-collapse: collapse;
  }

  .rendered-file__markdown :is(th, td) {
    padding: var(--space-1) var(--space-3);
    border: 1px solid var(--border);
  }

  .rendered-file__markdown img {
    max-width: 100%;
  }

  .rendered-file__note {
    margin: 0;
    padding: var(--space-4);
    border: 1px dashed var(--border-subtle);
    color: var(--text-muted);
  }
}
```
