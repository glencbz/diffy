---
name: jj
description: Use whenever writing or modifying code that shells out to the jj (Jujutsu) CLI, parses its output, or otherwise deals with jj concepts (commits, changes, revsets, diffs) in this repo. Diffy is a jj-backed code review tool (see docs/tech-plan.md) invoked jj via CLI, not a library — this skill has the template/revset syntax needed to get machine-readable output out of it. Also useful background whenever the user asks about jj commands directly.
---

# Working with the jj CLI

Diffy shells out to `jj` (never links a jj library — CLI is the stable
surface, per `docs/tech-plan.md`). The existing wrapper lives in
`src/jj.ts` (tangled from `docs/tech/jj.md` — see the `entangled` skill
before touching it).

## Core concepts

- **Change ID** vs **commit ID**: a change ID is stable across amends/rebases
  (jj's identity for "the same logical commit over time"); the commit ID
  changes whenever the content/metadata changes. Prefer change IDs when you
  mean "this logical commit" and commit IDs when you mean "this exact
  snapshot" (e.g. diffing).
- `@` is the working-copy commit (always exists, often has an empty/no
  description — don't assume every revision is "finished").
- Immutable revisions (root, and anything configured as immutable, shown
  with `◆`) can't be rewritten; mutable ones (`○`) can.
- This repo's `.jj` is colocated with `.git` — `jj log` and `git log` show
  the same underlying commits, just addressed differently.

## Getting machine-readable output

`jj` commands accept `-T`/`--template`, a small expression language (full
reference: `jj help -k templates`). Don't hand-roll delimited output —
there's a builtin `json(value)` function that serializes jj's own types
(`Commit`, `Signature`, etc. — anything marked `Serialize: yes` in the
template docs) with field names that are "usually stable" across versions.
Pattern used in `src/jj.ts`:

```sh
jj log --no-graph -T 'json(self) ++ "\n"'
```

- `--no-graph` (`-G`) is required for anything you're going to parse line by
  line — with the graph on, stdout has ASCII-art prefixed onto every line.
- One `json(self)` per commit, newline-separated → JSONL, trivially parsed
  with `.split("\n").filter(Boolean).map(JSON.parse)`.
- `json(self)` on a commit yields (empirically, jj 0.40):
  `commit_id`, `change_id`, `description` (empty string if unset, else
  trailing `\n`), `parents` (array of commit_id strings), `author` /
  `committer` (`{ name, email, timestamp }`).
- For a single custom field instead of the whole object, keywords are
  0-arg methods of `Commit`, e.g. `change_id.shortest()`,
  `description.first_line()`. String-building templates need
  `.escape_json()` if you're hand-assembling JSON rather than using `json()`.

Other commands accept `-T` too (`jj op log`, `jj show`, etc.) — the `Commit`
keywords are only in scope for commands whose primary subject is a commit
(`log`, `show`); `jj op log` templates use `Operation` keywords instead.

## Revsets (selecting commits)

Revset syntax reference: `jj help -k revsets`. Frequently useful:

- `all()` — every visible commit. **`jj log`'s default (`revsets.log`
  config) only shows mutable revisions plus a bit of context, not full
  history** — pass `-r 'all()'` (or `-r '::'`) explicitly when you need
  everything, e.g. for the "list of commits" case.
- `@` working copy, `x-`/`x+` parents/children, `x::y` range (ancestors of y
  that are descendants of x), `x..y` revisions in y not in x — this last one
  is exactly the shape needed for the "before/after" **interdiff** feature
  in `docs/tech-plan.md`. jj even has a builtin `jj interdiff` command
  ("Show differences between the diffs of two revisions") — check it before
  reimplementing that logic by hand.
- `-n`/`--limit` truncates *after* filtering/ordering, applied topologically
  before `--reversed`.

## Invoking jj from Bun

Use `Bun.$` (per project convention, not `child_process`/execa). Build the
argument list as a plain `string[]` and interpolate the whole array —
Bun Shell flattens an interpolated array into separate, individually-escaped
arguments (confirmed empirically), which is the clean way to make flags
conditional:

```ts
const args = ["log", "--no-graph", "-T", TEMPLATE];
if (revset) args.push("-r", revset);
await $`jj ${args}`.quiet().text();
```

Don't build the command as one big interpolated string — you lose Bun's
per-argument escaping and conditional flags get awkward.

## Gotchas

- `jj log` templates only expose `Commit` keywords — don't reuse the same
  template string against `jj op log` (different keyword set, `Operation`
  not `Commit`).
- The JSON field set from `json(self)` isn't a versioned/guaranteed schema
  (jj's own docs: "backward compatibility isn't guaranteed... if the
  underlying data model is updated") — if `jj` gets upgraded and parsing
  breaks, check `jj help -k templates` for the current `Commit` type fields
  first.
- `root()` commit has the all-zeros commit ID and an all-`z` change ID —
  expect it at the tail of `-r 'all()'` and decide whether to filter it out
  for a given use case.
