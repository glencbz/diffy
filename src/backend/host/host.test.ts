// ~/~ begin <<docs/architecture/backend/host.md#backend-host-test>>[init]
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
// ~/~ end
