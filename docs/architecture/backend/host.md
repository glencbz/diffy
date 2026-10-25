# The host

What diffy takes from the machine it runs on: the home directory, where it
keeps its files, the address the reader reaches it at, the command that runs
it, the browser it [records](recording.md) with, and the time. The
[command line](cli.md) reads them once into a `Host` and hands it down, so no
module below it reads `process.env`, `homedir()` or the clock itself, and a
test or a second server can run against a host of its own.

Each module taking the environment as a defaulted parameter would let a test
pass another, but every caller that left it out would still read the real one,
and a test that forgets writes into the reader's own review stores.

The `jj`, `git`, `gh` and `difft` processes diffy runs are the exception. They
are found on `PATH` and inherit the process's environment, so `GH_HOST` and
jj's own configuration reach them the way they reach the same command typed in
a shell.

```ts
//| id: backend-host
//| file: src/backend/host/host.ts
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
```

## Tests

```ts
//| id: backend-host-test
//| file: src/backend/host/host.test.ts
import { expect, test } from "bun:test";
import { hostFrom } from "./host";

test("puts diffy's files under the XDG directories, or their defaults", () => {
  expect(hostFrom({}, "/home/me")).toMatchObject({
    dataDir: "/home/me/.local/share/diffy",
    stateDir: "/home/me/.local/state/diffy",
    publicUrl: null,
  });
  expect(
    hostFrom(
      {
        XDG_DATA_HOME: "/d",
        XDG_STATE_HOME: "/s",
        DIFFY_PUBLIC_URL: "https://vm",
      },
      "/home/me",
    ),
  ).toMatchObject({
    dataDir: "/d/diffy",
    stateDir: "/s/diffy",
    publicUrl: "https://vm",
  });
});

test("records with the browser named, or none when nothing is cached", () => {
  expect(hostFrom({ DIFFY_CHROMIUM: "/c" }, "/home/me").browser).toBe("/c");
  expect(
    hostFrom({ PLAYWRIGHT_BROWSERS_PATH: "/nowhere" }, "/home/me").browser,
  ).toBeNull();
});
```
