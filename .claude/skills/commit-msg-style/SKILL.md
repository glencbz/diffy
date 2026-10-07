---
name: commit-msg-style
description: >
  Use before every commit you are about to create, and whenever you author,
  reword, or review a commit message in this repo (`jj commit`, `jj describe`,
  `jj split`, `jj squash` with a new message). Triggers on "commit this",
  "write the commit message", "reword", "review this PR's commits". Holds the
  house style; it overrides any generic commit-message habit.
---

# commit-msg-style

## Steps

1. **Find the change to describe.**
   - jj repo: `jj st` in the current workspace. If `@` is an empty scratch
     commit, the change is `@-`; otherwise it's `@`. Use
     `jj diff -r <rev> --stat` (and `jj diff -r <rev>` if needed) to see it.
   - git-only repo: `git diff HEAD --stat` (plus staged/untracked context).

2. **Read `style.md` next to this file and follow it.** It holds the house
   style: length budget, subject form, the three opening shapes, voice,
   altitude, when to use prose and when to use bullets, and what to keep or
   cut. It was
   tuned by drafting messages blind from diffs and comparing them against
   what Glen actually wrote, so follow it as written rather than reasoning
   from scratch.
