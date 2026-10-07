---
name: commit-shape
description: >
  Use when splitting or reviewing a commit or a PR's history in this repo:
  deciding what belongs in one commit and whether a commit should be split.
  Triggers on "review this PR's commits", "split this commit", "is this commit
  too big". For the wording of the message itself, use `commit-msg-style`.
---

# Commit shape

## One objective per commit

A commit delivers exactly one objective. Sub-goals are fine; the bound is
cognitive complexity, not line count. A reviewer must be able to hold the whole
commit in their head at once and say what it is for in a sentence.

Prefer an objective that is visible to someone using the tool ("the commit graph
draws side-by-side branch lanes") over one visible only in the source ("extract
a shared JSON helper"). Source-only objectives are legitimate commits, but they
are enabling work, not the destination.

### Deciding whether to split

Enabling work rides along with the feature when it is simple: a new parameter, a
threaded-through option, a helper with one obvious caller.

Split it into its own commit when either holds:

- **It is non-obvious.** A reviewer cannot confirm it preserves behaviour by
  reading it next to the feature; they have to reconstruct the old shape first.
- **It dominates the diff.** The mechanical churn is large enough that the
  feature is hard to find inside it.

Split for the reader, not for tidiness. The test of a good split: the prep
commit can be read on its own and agreed to change no behaviour, and then the
feature commit reads as the feature alone.

Order prep before payoff. Enabling commits come first; the commit that makes the
change user-visible comes after; post-feature clean up after that.

### Splitting mechanics

This repo is jj-backed and literate (see the `jj` and `entangled` skills).
Source of truth is the fenced blocks in `docs/**/*.md`; `src/**` and `justfile`
are tangled output. A split must therefore move the doc prose and its code block
together, and the tangled files must be regenerated so each commit is
independently buildable, not just the last one.

## The message

Write and check the message with the `commit-msg-style` skill. This skill
decides what the commit holds; that one decides how its message reads.

## Incidental work

Anything in the commit that is not the main thrust must be framed by rationale
and objective, so the reader can tell why it is here rather than in its own
commit.

Name what forced it. "Also tidied the error handling" does not earn its place;
"the new call site needs the same 400-on-bad-input behaviour the old one had
inline, so that moves into a shared helper" does.

If you cannot write that sentence honestly, the change does not belong in this
commit.

## Reviewing a commit or PR

First review the message for clarity, then the diff. Use the message to
understand what should be in the diff, then review the diff like so:

1. **Parse summary.** Read the commit message to tell if it is clear what the
   diff should look like. Take note of anything non-obvious. Leave the shape of
   the message to step 6.
2. **Enumerate.** List the distinct things the commit does, one line each.
   Distinct means a reviewer would verify it separately.
3. **Count.** Compare the count against the stated objective. One objective plus
   its sub-goals is fine. Two peers that could ship in either order is a split.
4. **Test each non-main item** against *Incidental work*: is there an honest
   rationale sentence tying it to the objective? If not, split out the work.
5. **Check coverage.** Does the message account for everything on the list?
   Silent changes are the failure this catches: work in the diff that no line of
   the message would lead a reviewer to expect.
6. **Check the wording** against `commit-msg-style`: length budget, subject,
   opening shape, voice, altitude, and what it cuts.

Report findings as: the enumerated list, then a verdict of *keep as one*,
*reword*, or *split into N* with the proposed commit boundaries and subjects.

When you act on a split, also update the PR body so it describes the series
rather than one commit, and keep the verification evidence attached to whichever
commit it proves.
