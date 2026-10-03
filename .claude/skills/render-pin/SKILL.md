---
name: render-pin
description: >
  Use when refactoring diffy's React views without meaning to change what
  they draw (splitting, nesting, moving, or renaming files under
  src/frontend/views, extracting subcomponents, reshuffling props), and when
  reviewing such a PR. Renders a fixture of view cases to static HTML at two
  revisions, each in its own jj checkout, and compares the markup byte for
  byte. Write the fixture before moving anything.
---

# Pinning a view refactor to its markup

A behavior-preserving view refactor should draw the same HTML. `render-pin.sh`
proves it: it renders every case in a fixture with `renderToStaticMarkup` at a
before revision and an after revision, then compares the two outputs.

```sh
.claude/skills/render-pin/render-pin.sh <fixture.tsx> [before-rev] [after-rev]
```

- `before-rev` defaults to `trunk()`. Use the parent of your first refactor
  change when the stack sits on something other than main.
- `after-rev` defaults to this working copy, uncommitted edits included. Name
  a revision to check a pushed PR head instead.
- It prints `IDENTICAL` and exits 0, or prints `DIFFERENT` with a diff of the
  first differing lines, one tag per line, and exits 1.

Each revision gets a throwaway jj workspace with its own `bun install`, so each
side's views load the React they were built against. The script forgets those
workspaces and abandons their commits on exit. `src/` is generated from
`docs/` (see the `entangled` skill), so tangle before you pin the working copy.

## Writing a fixture

A fixture default-exports a function that takes a `Pin` (see `pin.ts`):

- `from(before, after?)` imports a module by its repo-relative path in the
  checkout being rendered. Give both paths when the refactor moves the file.
- `render(name, element)` records one case.

Load everything through `from`, including `model/` values such as
`DEFAULT_SETTINGS`. A plain relative import resolves somewhere else, because
the fixture runs from a copy under the checkout's `node_modules`. Type-only
imports are erased and do no harm.

Cover each branch the refactor touches: every prop that switches markup on or
off, each layout and mode, empty and loaded states. Server rendering draws
initial state only. Prove clicks and state changes in the real app with the
`verify-diffy` skill. Keep cases deterministic: no `Math.random`, no
`Date.now`.

Run the pin once before the first move. A fixture that fails on the before
side is a broken fixture, not evidence. Then rerun it after each step.

`examples/nest-views.tsx` is the pin for PR #90, which nested `DiffView` and
the pull request views. Start a new fixture from it.

## Evidence

Paste the `IDENTICAL` line, with its case count and byte count, into the
commit body or PR description. A reviewer can rerun the same command against
the PR head.
