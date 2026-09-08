// ~/~ begin <<docs/architecture/backend/jj.md#jj-module>>[init]
import { $ } from "bun";
import * as z from "zod";

/** The `jj` CLI ran and exited non-zero — usually an unresolvable revset. */
export class JjError extends Error {
  constructor(
    message: string,
    readonly exitCode: number,
  ) {
    super(message);
    this.name = "JjError";
  }
}

/** Keep jj's `Error:` lines; drop the "Done importing changes…" preamble. */
function cleanStderr(stderr: string): string {
  const errors = stderr.split("\n").filter((line) => line.startsWith("Error:"));
  return (errors.length > 0 ? errors.join("\n") : stderr).trim();
}

async function runJj(args: string[]): Promise<string> {
  try {
    return await $`jj ${args}`.quiet().text();
  } catch (error) {
    if (error instanceof $.ShellError) {
      const message =
        cleanStderr(error.stderr.toString()) || `jj exited ${error.exitCode}`;
      throw new JjError(message, error.exitCode);
    }
    throw error;
  }
}
// ~/~ end
// ~/~ begin <<docs/architecture/backend/jj.md#jj-module>>[1]

export interface JjLogEntry {
  commitId: string;
  changeId: string;
  description: string;
}

const JjLogEntryWire = z.object({
  commit_id: z.string(),
  change_id: z.string(),
  description: z.string(),
});

export interface JjLogOptions {
  revset?: string;
  limit?: number;
}

const LOG_TEMPLATE = 'json(self) ++ "\n"';

export async function jjLog(options: JjLogOptions = {}): Promise<JjLogEntry[]> {
  const args = ["log", "--no-graph", "-T", LOG_TEMPLATE];
  if (options.revset !== undefined) args.push("-r", options.revset);
  if (options.limit !== undefined) args.push("-n", String(options.limit));

  const output = await runJj(args);

  return Promise.all(
    output
      .split("\n")
      .filter((line) => line.length > 0)
      .map(async (line) => {
        const commit = await JjLogEntryWire.parseAsync(JSON.parse(line));

        return {
          commitId: commit.commit_id,
          changeId: commit.change_id,
          description: commit.description,
        };
      }),
  );
}
// ~/~ end
