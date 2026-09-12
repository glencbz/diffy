---
name: commit-shape
description: >
  Use when authoring, splitting, rewording, or reviewing a commit or a PR's
  history in this repo: deciding what belongs in one commit, whether a commit
  should be split, and what its message should say. Triggers on "review this
  PR's commits", "split this commit", "write the commit message", "is this
  commit too big", and on every commit you are about to create.
---

# Commit shape and messages

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
change user-visible comes last.

### Splitting mechanics

This repo is jj-backed and literate (see the `jj` and `entangled` skills).
Source of truth is the fenced blocks in `docs/**/*.md`; `src/**` and `justfile`
are tangled output. A split must therefore move the doc prose and its code block
together, and the tangled files must be regenerated so each commit is
independently buildable, not just the last one.

## Message altitude

The message accounts for every change in the commit, at the altitude of
objective and rationale. Aim it at a reader who wants to know what this commit
is for and why it touches what it touches.

Do not narrate code-level mechanics. Name a specific function, parameter, or
deletion only when that particular detail would surprise the reader or is the
one thing they need to look at.

Negative: `Change functionX() to accept Y param, delete functionY().`

Positive: `Introduce UI feature X. It needs progress from subsystem A, so write
the plumbing for that.`

Mood, tense, capitalization, subject length, and wrapping are set by the
"Commit messages" section of `CLAUDE.md`. Follow that section; this skill does
not restate it.

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

Review the diff first, then the message. Judging the message against itself
tells you nothing.

1. **Enumerate.** List the distinct things the commit does, one line each.
   Distinct means a reviewer would verify it separately.
2. **Count.** Compare the count against the stated objective. One objective plus
   its sub-goals is fine. Two peers that could ship in either order is a split.
3. **Test each non-main item** against *Incidental work*: is there an honest
   rationale sentence tying it to the objective? If not, it splits out.
4. **Check coverage.** Does the message account for everything on the list?
   Silent changes are the failure this catches: work in the diff that no line of
   the message would lead a reviewer to expect.
5. **Check altitude.** Is anything narrated at code level that should be an
   objective, or vice versa?
6. **Check the mechanics** against the "Commit messages" section of `CLAUDE.md`:
   imperative subject, present tense for the code as it stands before the
   change, no "this commit" or "I changed", subject case and length, body
   wrapped at 72. These are checkable without judgement, so check them last and
   do not skip them.

Report findings as: the enumerated list, then a verdict of *keep as one*,
*reword*, or *split into N* with the proposed commit boundaries and subjects.

When you act on a split, also update the PR body so it describes the series
rather than one commit, and keep the verification evidence attached to whichever
commit it proves.
