// ~/~ begin <<docs/architecture/backend/host.md#backend-host>>[init]
import { readdirSync } from "node:fs";
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
  /** The Chromium a recording drives, or null for the one Playwright
   *  would download. */
  browser: string | null;
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
    browser:
      env.DIFFY_CHROMIUM ||
      cachedChromium(
        env.PLAYWRIGHT_BROWSERS_PATH || join(home, ".cache", "ms-playwright"),
      ),
    now: () => new Date(),
  };
}

/** The newest Chromium Playwright has downloaded under `dir`. A browser
 *  driver of another version, such as an MCP server's, often fetched one
 *  that diffy's Playwright would not pick by its own revision. */
function cachedChromium(dir: string): string | null {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return null;
  }
  const newest = names
    .filter((name) => /^chromium-\d+$/.test(name))
    .sort((a, b) => Number(a.slice(9)) - Number(b.slice(9)))
    .at(-1);
  return newest === undefined
    ? null
    : join(dir, newest, "chrome-linux64", "chrome");
}
// ~/~ end
