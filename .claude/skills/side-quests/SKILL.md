---
name: side-quests
description: >
  Load at the start of every focused piece of work (a feature, a fix, a
  refactor in one area of the code). While working, when you hit a problem in
  that area that is not part of the task, such as a bug, a stale comment, a
  broken test, a confusing name, or a doc that disagrees with the code, hand
  it to a background subagent that fixes it in its own small PR, instead of
  widening your change or ignoring it.
---

# Side quests

A focused change stays focused. When you trip over something nearby that is
not part of the task, do not fold it into your change and do not walk past it.
Spin it off.

## When to spin one off

All of these hold:

- You found it while working in this area, and it is not needed for your task.
- You can state it in two sentences: what is wrong and where.
- It looks small: one concern, a handful of files at most, no design decision.

If it needs a design call, touches many files, or you cannot say what the fix
is, do not spawn. Note it in your final report for Glen instead.

Check first that it is not already handled: `jj log` for a bookmark or open PR
covering it. Spin off one subagent per problem, and do not wait on it.

## How to spin one off

Use the Agent tool with `run_in_background: true` and `isolation: "worktree"`
(the hooks in `.claude/settings.json` turn that into a jj workspace). Brief it
cold, since it has not seen your session:

- the problem, the file and line, and how you noticed it;
- the size budget below and the instruction to bail;
- the repo rules: work in `docs/**` and tangle (`entangled` skill), commits per
  `commit-shape` and `commit-msg-style`, open the PR only through
  `submit-for-review`, branch off `trunk()` and never off your change.

Keep your own change untouched. The side quest must not depend on it, and it
must not land in your PR.

## The subagent's size budget

The fix must stay a small PR: one concern, roughly 50 changed lines of
hand-written code or prose (not counting tangled output), no new abstraction,
no API or schema change, and no behavior change that needs a new decision.

Check the size as you go (`jj diff --stat`), not at the end. If any of these
happens, **bail**:

- the diff passes the budget or spreads across unrelated areas;
- the fix turns out to need a design decision or a refactor first;
- the cause is not what was reported, and the real one is larger;
- tests need broad rework to pass.

To bail: abandon the change (`jj abandon`, and `jj workspace forget` if you
made one), push nothing, open no PR, and report in under 100 words what the
problem really is and why it is bigger. Do not ship a partial or
"good enough for now" fix. The parent passes your report on to Glen.

## When it succeeds

The subagent opens the PR through `submit-for-review` and reports the PR link
in one or two lines. Mention each side-quest PR in your final summary next to
your main one, so Glen can review them separately.
