---
name: docs-prose
description: >
  Use whenever you write, edit, or review prose in this repo's literate docs
  (`docs/**/*.md`): adding a section for new code, updating one after a
  change, or reviewing a PR that touches them. Sets what belongs in doc prose,
  what belongs in a code comment instead, and what belongs nowhere. Use with
  the `entangled` skill, which covers the code blocks.
---

# Writing the literate docs

The docs are the source of truth, and a code block is already in front of the
reader. Prose earns a place only by saying something that block cannot.

## What the prose is for

Each section answers one or both of these, and stops:

- **The flow.** How this piece fits with the others: what calls it, what it
  hands on, and which rule spans several functions or files. A reader should
  finish the section knowing where to look, not having read the code twice.
- **The decision.** Why the code has this shape, when an obvious alternative
  was rejected. Name the alternative and say in a sentence why it loses.

## Where everything else goes

Before writing a sentence, ask which of three places it belongs in.

1. **The doc.** It spans more than one site, or records a rejected
   alternative.
2. **A comment at the site.** It explains one line, one constant, one CSS rule,
   or one branch, such as why a limit is 1 MB, why a listener captures, or why
   `min-height: 0` is there. Put it in the code block as a comment and keep it
   to a line or two. The comment travels with the code; a paragraph three
   screens away does not.
3. **Nowhere.** It is any of these:
   - **Restated code.** It names a function's arguments, lists its branches,
     or describes a type the block declares. "`useCommits` takes a `Source`
     and reloads whenever it changes" adds nothing to the signature.
   - **History.** It says what the code used to do, what was tried first, or
     how a decision was reached ("we first tried htmx", "it used to live in
     `localStorage`", "this replaces a defect the old default had"). The doc
     describes the code as it is. A rejected alternative is written as the
     option that lost, never as a past state.
   - **Inventory.** It counts or itemizes a set the code can grow, such as
     "three routes use it" or a bullet per hook. The code block is the
     inventory; prose names the mechanism.
   - **Restated neighbours.** It repeats what another doc already says. Link
     to that doc instead.
   - **Generic advice or obvious UX.** "A native select is keyboard-accessible",
     or "a reader wants to see what changed".
   - **Narrated tests.** It describes what each test checks. Say why a test
     exists only when its shape is non-obvious, as with a property test or
     a fixture taken from real data, and then in a sentence.

## Shape

- Lead the doc with one or two sentences saying what it covers. No preamble.
- Keep one idea to a paragraph and three to six lines in a paragraph. If a
  paragraph needs a second idea, it is two paragraphs or a comment.
- A heading followed directly by a code block is fine. Don't write a sentence
  just to fill the gap.
- Link to the doc that owns a concept rather than re-explaining it. Keep
  anchors stable, because other docs link to them.
- When the code changes, update or delete the prose that described it in the
  same commit. Stale prose is worse than none: in PR #86, `paired-graph.md`
  still said rows were keyed by index after the code keyed them by commit
  ids.

## Before and after

Too much, because it restates the code and explains one call site at length:

> `useLocalHistory` owns the one piece of state both sides and the pickers
> read. It polls `fetchOperations` every two seconds while the tab is
> visible, and at once when the tab becomes visible again. A `polling` ref,
> not state, keeps two requests from being in flight at once. A failed poll
> after the first success leaves the last good list on screen...

Right, because it gives the flow and the rejected alternative:

> `useLocalHistory` polls `fetchOperations` every two seconds while the tab
> is visible. `jj op log` snapshots the working copy first, so a poll also
> turns a file edit into an operation. A server watching `op_heads` and
> pushing over a socket would need a watcher and a channel, and would still
> miss an edit until some jj command snapshotted it.

A single-site reason moves into the code:

```ts
/** Difftastic's own `DFT_BYTE_LIMIT`. Above it difftastic falls back to a slow
 *  line diff of its own (a 4 MB file took 38 s), the same one `git` gives. */
const BYTE_LIMIT = 1_000_000;
```

## Checking a change

For each paragraph you wrote or touched, decide whether it is flow, decision,
site comment, or nowhere, and move or delete it accordingly. Then:

- `uv run entangled tangle` and confirm the generated files changed only where
  you meant them to.
- `uv run mkdocs build --strict`.
- Check that any `#anchor` you renamed or removed is not linked from another
  doc: `grep -rn '#<anchor>' docs`.
