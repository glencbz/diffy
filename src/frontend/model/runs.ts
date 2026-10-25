// ~/~ begin <<docs/architecture/backend/runs.md#frontend-model-runs>>[init]
import * as z from "zod";
import { BlobName } from "./evidence";

export const Request = z.object({
  method: z.string(),
  /** The path and query, or the whole address for another origin. */
  url: z.string(),
  /** Null when no answer came. */
  status: z.number().int().nullable(),
  /** What the browser fetched it as: document, script, fetch... */
  type: z.string(),
  /** The answer to a fetch, as text, cut short past a limit. */
  body: z.string().nullable(),
});
export type Request = z.infer<typeof Request>;

export const Logged = z.object({
  level: z.enum(["log", "info", "warn", "error", "debug"]),
  text: z.string(),
});
export type Logged = z.infer<typeof Logged>;

/** The lines of one file a step ran, as inclusive runs, in order. */
export const Ran = z.object({
  path: z.string(),
  lines: z.array(z.tuple([z.number().int(), z.number().int()])),
});
export type Ran = z.infer<typeof Ran>;

export const RunStep = z.object({
  label: z.string(),
  /** The window once the step settled. */
  shot: BlobName,
  requests: z.array(Request),
  console: z.array(Logged),
  ran: z.array(Ran),
});
export type RunStep = z.infer<typeof RunStep>;

export const RunSide = z.object({
  steps: z.array(RunStep),
  /** Why the side stopped before its last step, or null. */
  stopped: z.string().nullable(),
});
export type RunSide = z.infer<typeof RunSide>;

export const Run = z.object({
  series: z.string(),
  version: z.string(),
  commitId: z.string(),
  /** The same in every version that has it. */
  id: z.string().min(1),
  name: z.string().min(1),
  state: z.array(z.string()).default([]),
  about: z.string().default(""),
  /** At the commit's parent, when there is one to play. */
  before: RunSide.nullable(),
  after: RunSide,
  recordedAt: z.string(),
});
export type Run = z.infer<typeof Run>;

const sameRun = (a: Run, b: Run) =>
  a.series === b.series &&
  a.version === b.version &&
  a.commitId === b.commitId &&
  a.id === b.id;

/** `runs` with `run` in place of any of its commit's with its id. */
export function withRun(runs: Run[], run: Run): Run[] {
  return [...runs.filter((each) => !sameRun(each, run)), run];
}

/** The runs of one version of a series, in the order they came. */
export function runsOf(runs: Run[], series: string, version: string): Run[] {
  return runs.filter(
    (each) => each.series === series && each.version === version,
  );
}

/** Turns line numbers into inclusive runs, in order. */
export function lineRuns(lines: Iterable<number>): [number, number][] {
  const sorted = [...new Set(lines)].sort((a, b) => a - b);
  const out: [number, number][] = [];
  for (const line of sorted) {
    const last = out.at(-1);
    if (last !== undefined && last[1] === line - 1) last[1] = line;
    else out.push([line, line]);
  }
  return out;
}
// ~/~ end
