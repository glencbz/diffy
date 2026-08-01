---
name: entangled
description: Use whenever you are about to write, edit, or generate code, config, or scripts in this repository (diffy) — including source files like src/**, the justfile, or any new file. This project is an Entangled literate-programming project: real source of truth lives in fenced code blocks inside docs/*.md, and files like justfile / src/index.ts are auto-generated ("tangled") from them. Trigger before creating a new source file, before editing an existing generated file, or before adding a new script/recipe.
---

# Working with Entangled in this repo

This repo uses [Entangled](https://entangled.github.io/) (literate programming).
**The markdown files under `docs/` are the source of truth for code — not the
generated files.** Generated files are marked with comments like:

```
// ~/~ begin <<docs/tech/bun.md#demo-bun>>[init]
...
// ~/~ end
```

Currently `justfile` and `src/index.ts` are fully tangled outputs (see
`entangled status` for the live list of dependent files). Treat any file with
`~/~ begin/end` markers as generated.

## Golden rule

**Never hand-edit a generated file and leave it out of sync.** If a file has
`~/~ begin <<...>>` markers, edit the corresponding block in the `docs/*.md`
file instead, then tangle. If you must edit the generated file directly (e.g.
a quick fix), immediately run sync afterwards so the change gets stitched
back into the markdown — don't let the two drift apart.

## Adding or changing code

1. Pick the doc under `docs/` (any depth — it's reorganized into subfolders
   like `docs/tech/`, `docs/devtools/` from time to time) that topically owns
   the code — e.g. the Bun/TS backend doc, the justfile-composition doc, the
   uv/python doc. Search by topic/id, don't hardcode a path, since files move.
   Create a new doc under `docs/` if none fits — it just needs to match the
   `watch_list` glob `docs/**/*.md` in `entangled.toml`.
2. Add a fenced code block whose language tag is one of the identifiers
   configured in `entangled.toml` (`[[languages]]`). **Only `ts`/`typescript`
   and `just` are configured today.** If you need another language (e.g.
   Python), add a `[[languages]]` entry to `entangled.toml` first — see
   https://entangled.github.io/ for the identifiers/comment syntax.
3. Inside the block, add attributes as a comment on the first line(s), using
   that language's comment prefix + `|`:
   - `#| id: some-unique-id` — every block needs an id.
   - `#| file: path/to/output` — only on the block(s) that should become an
     actual file on disk (the "root" block for that file).
   - Blocks without `file:` are reusable fragments, pulled in elsewhere via
     noweb references: `<<some-unique-id>>` on its own line, indentation
     preserved.
4. Compose fragments into root blocks with `<<id>>` references (see the
   justfile-composition doc referencing `<<just-uv-install>>`,
   `<<just-entangled>>`, etc., or append more code under the same `id` —
   order of appearance matters for appends).
5. Run `just en-sync` (== `uv run entangled sync`) to tangle the docs into
   real files. Use `just en-tangle` / `uv run entangled tangle -s` for a dry
   run first if unsure. Commit both the `docs/*.md` change and the generated
   file together.

## Useful commands

- `uv run entangled status` — shows configured languages/hooks and the
  input-doc → generated-file dependency tree.
- `uv run entangled sync` — smart bidirectional sync (tangle *or* stitch,
  whichever direction has changes). This is what `just en-sync` runs.
- `uv run entangled tangle -s` / `entangled stitch -s` — dry run (`--show`),
  prints what would change without writing.
- `uv run entangled stitch` — pushes edits made directly in generated files
  back into the markdown.

## Gotchas

- Attribute lines can be `#| id: x` or `# | id: x` (space before `|`) —
  both are seen in this repo; either works with the `quarto_attributes` hook.
- Don't hand-edit or remove the `~/~ begin/end` marker comments — Entangled
  owns them.
- `entangled reset` rewrites the file database as if a tangle had just run,
  without touching files — only use it if the db and files have gotten
  confused (e.g. after manual file surgery), not as a routine command.
