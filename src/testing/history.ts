// ~/~ begin <<docs/devtools/testing.md#testing-history>>[init]
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";

/** Commits of `main` that tests read in place of a moving tip. `commit`
 *  and `parent` are small, so difftastic diffs them quickly. */
export const FIXED = {
  /** "misc: init pyproject, add entangled", the first commit, which adds
   *  every file it holds */
  first: "7e10532570efe623141caa3eb08408544bb1b21d",
  /** "js: add bun", its child, which modifies some of them */
  second: "a8e27912ce338de89477c1d072b6a0835d9b6c2c",
  /** "just: move justfile into docs", the child of that */
  third: "a00f6cac320885a4e520355d19dae3b78ee7da73",
  /** "components: show the switch disabled without a map" */
  commit: "aa7fc225d103a8fe4a15acf326746d3c5d25f170",
  changeId: "klzxmnznkxytllrquluxoxupuosrqrno",
  /** "agent: ask for a component map with each review", its only parent */
  parent: "01f87a561627eb427a7c141522b483e6043fa1cb",
  parentChangeId: "nnxzkttynuskltryklrxrzutqswxrvtn",
  /** A merge's two sides, neither the other's ancestor, and the commit
   *  they grew out of. Each side touches three files, so it diffs quickly. */
  diverged: {
    /** "agent: read the reader's review history (#131)" */
    base: "37f4eec4c2718cc17a3b661d59cb95ec8f12a8a2",
    /** "jj: list the log in jj's own graph order" */
    head: "12fcad9156cec20d9973f4335b0c1020aa895f4b",
    /** "cli: open the repository used last, not the shell's (#142)" */
    mergeBase: "26ff2e263f5617b1e49e7bc982262585f8fec50e",
  },
} as const;

export interface ScratchRepo {
  root: string;
  remove: () => Promise<void>;
}

/** A fresh jj repository with two described commits, `first` then
 *  `second`, the working copy an empty change on top, and `second`
 *  bookmarked as `feature`. */
export async function scratchRepo(): Promise<ScratchRepo> {
  const root = await mkdtemp(join(tmpdir(), "diffy-scratch-"));
  const jj = (args: string[]) => $`jj ${args}`.cwd(root).quiet();
  await jj(["git", "init"]);
  await Bun.write(join(root, "a.ts"), "export const a = 1;\n");
  await jj(["describe", "-m", "first"]);
  await jj(["new"]);
  await Bun.write(join(root, "a.ts"), "export const a = 2;\n");
  await Bun.write(join(root, "b.ts"), "export const b = 1;\n");
  await jj(["describe", "-m", "second"]);
  await jj(["bookmark", "create", "feature", "-r", "@"]);
  await jj(["new"]);
  return {
    root,
    remove: () => rm(root, { recursive: true, force: true }),
  };
}
// ~/~ end
