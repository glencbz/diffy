// ~/~ begin <<docs/architecture/frontend/diff.md#frontend-view-collapse>>[init]
import type { FileDiff } from "../api";
import { readPatch } from "./patch";

/** Files a package manager writes and resolves on the author's behalf. */
const LOCK_FILES = new Set([
  "bun.lock",
  "bun.lockb",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "deno.lock",
  "Cargo.lock",
  "flake.lock",
  "uv.lock",
  "poetry.lock",
  "Pipfile.lock",
  "Gemfile.lock",
  "composer.lock",
  "go.sum",
  "mix.lock",
  "Podfile.lock",
  "pubspec.lock",
  "packages.lock.json",
]);

/** Paths only a build step writes. */
const GENERATED_PATHS = [
  /\.min\.(js|css)$/,
  /\.map$/,
  /(^|\/)dist\//,
  /\.pb\.go$/,
  /_pb2\.pyi?$/,
];

/** What a generator writes at the top of its output. */
const GENERATED_MARKER = /@generated|^\W*Code generated .* DO NOT EDIT\.?/;

/** How far down the after side a generator's marker is looked for. */
const MARKER_LINES = 5;

/** Changed lines past which a diff starts folded. */
export const LARGE_DIFF = 400;

/** Why a file starts folded, in the words its header shows, or `null` when
 *  it starts open. */
export function collapseReason(file: FileDiff): string | null {
  const path = "path" in file ? file.path : file.newPath;
  const name = path.slice(path.lastIndexOf("/") + 1);
  if (LOCK_FILES.has(name) || name.endsWith(".lock")) return "lock file";
  if (GENERATED_PATHS.some((pattern) => pattern.test(path))) return "generated";

  const lines = readPatch(file.patch).hunks.flatMap((hunk) => hunk.lines);
  const marked = lines.some(
    (line) =>
      line.kind !== "note" &&
      line.kind !== "removed" &&
      line.newLine <= MARKER_LINES &&
      GENERATED_MARKER.test(line.code),
  );
  if (marked) return "generated";

  const changed = lines.filter(
    (line) => line.kind === "added" || line.kind === "removed",
  ).length;
  if (changed > LARGE_DIFF) return `large diff, ${changed} changed lines`;
  return null;
}
// ~/~ end
