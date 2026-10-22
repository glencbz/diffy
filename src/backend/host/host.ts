// ~/~ begin <<docs/architecture/backend/host.md#backend-host>>[init]
import { homedir } from "node:os";
import { join } from "node:path";

export interface Host {
  /** The directory a path typed with `~` starts from. */
  home: string;
  /** Review stores and the recent list: `$XDG_DATA_HOME/diffy`. */
  dataDir: string;
  /** The per-user server's port and log: `$XDG_STATE_HOME/diffy`. */
  stateDir: string;
  /** Where the reader opens this server, when a proxy puts it somewhere
   *  other than the address a request came in on. */
  publicUrl: string | null;
  /** The command that runs this diffy again, before its arguments. */
  diffy: string[];
  now: () => Date;
}

export function hostFrom(
  env: Record<string, string | undefined>,
  home: string = homedir(),
): Host {
  return {
    home,
    dataDir: join(env.XDG_DATA_HOME || join(home, ".local", "share"), "diffy"),
    stateDir: join(
      env.XDG_STATE_HOME || join(home, ".local", "state"),
      "diffy",
    ),
    publicUrl: env.DIFFY_PUBLIC_URL || null,
    // A compiled diffy is its own executable; under `bun run` the script is
    // an argument.
    diffy: Bun.main.startsWith("/$bunfs/")
      ? [process.execPath]
      : [process.execPath, Bun.main],
    now: () => new Date(),
  };
}
// ~/~ end
