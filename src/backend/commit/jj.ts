// ~/~ begin <<docs/architecture/backend/jj.md#jj-module>>[init]
import { $ } from "bun";
import * as z from "zod";

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

  const output = await $`jj ${args}`.quiet().text();

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
