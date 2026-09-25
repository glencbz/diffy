// ~/~ begin <<docs/architecture/frontend/rendered-files.md#frontend-view-rendered-file>>[init]
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
// ~/~ end
// ~/~ begin <<docs/architecture/frontend/rendered-files.md#frontend-view-rendered-file>>[1]

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
// ~/~ end
