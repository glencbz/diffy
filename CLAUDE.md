---
description: Use Bun instead of Node.js, npm, pnpm, or vite.
globs: "*.ts, *.tsx, *.html, *.css, *.js, *.jsx, package.json"
alwaysApply: false
---

Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun:test` instead of `jest` or `vitest`, and run it through `just test`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads .env, so don't use dotenv.

## APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

## Testing

Run tests with `just test`. It runs `bun test` inside the pinned `nix`
runtime, which puts difftastic on the `PATH`; a bare `bun test` fails the
difftastic tests. Write tests with `bun:test`.

## Code

The `justfile` and everything under `src/` are tangled from fenced blocks in
`docs/**/*.md`. Change the doc and tangle; see the `entangled` skill.

## Frontend

`src/server.ts` serves `src/frontend/index.html` as an HTML import, and Bun
bundles the React app it loads. Don't use `vite`. `just run` starts the app in
Bun's dev mode; `just serve` starts it in production mode for review. For
more, read the Bun API docs in `node_modules/bun-types/docs/**.mdx`.

## Docs

- Load the `docs-prose` skill before writing or editing prose in
  `docs/**/*.md`.

## Version control

- This repo is jj-backed (colocated jj + Git). Use `jj`, not `git`, for
  everyday work. See the `jj` skill.
- Never create a `git worktree`. jj cannot see edits made in one, so they are
  never snapshotted. `.claude/settings.json` wires up two guards:
  - `WorktreeCreate` / `WorktreeRemove` hooks — when the harness requests
    worktree isolation (a background or bridge session, `--worktree`,
    `EnterWorktree`, agent `isolation: "worktree"`), they provision a **jj
    workspace** under `.claude/worktrees/<name>` instead of a git worktree.
  - a `SessionStart` hook — if a git worktree still slips through, it tells the
    session to provision its own jj workspace and move there.
- If a session lands in a `.claude/worktrees/<name>` git worktree anyway, the
  workaround is to provision a jj workspace, not to edit the main checkout:
  `jj workspace add .claude/worktrees/<name>-ws`, `cd` into it, work there, and
  `jj workspace forget <name>-ws` when done. Other sessions share the `default`
  workspace, so working in the main checkout from a trapped session collides
  with theirs.
- For an isolated working copy by hand, use
  `jj workspace add .claude/worktrees/<name>` and `cd` into it so edits land in
  that workspace, not `default`. A normal foreground session with no such trap
  just works in the main checkout on a jj change, adding a Git bookmark at the
  PR boundary.

## GitHub workflow

- Finish every requested change on a dedicated branch, commit it, push it, and open a GitHub pull request. Do not commit directly to `main`.
- Open or update every pull request through the `submit-for-review` skill,
  including when nobody asked for a review. It is the only way a PR here gets
  its preview servers and the URLs that go in its body.

## Commit messages

- Prefix commit subjects with the affected subarea (for example, `skills:`), not Conventional Commit types such as `feat:`, `fix:`, or `chore:`.
- Write the subject in the imperative mood, as an order to the codebase: `make the picker remember its selection`, not `makes`, `made`, or `fixing`. The subject should complete the sentence "if applied, this commit will ___".
- Do not capitalize the word after the `area:` prefix unless it is a proper term, as in `refs: HEAD is also treated as a ref`. No full stop at the end. Aim for 50 characters and never pass 72.
- Describe the code as it stands before the change in the present tense: "the log draws every commit in one lane", not "drew" or "used to draw". That code is what the reader has in front of them.
- Never write "this patch", "this commit", or "I changed X". Give the order and state the problem; the commit is implicit.
- Wrap commit messages at 72 characters.
- Say what the change does and why the result is better. Leave how to the diff and the docs. Name alternatives you considered and rejected.
- Make the message stand on its own. Summarize a linked discussion rather than only pointing at it.
- Use the commit body for useful context that is not obvious from the diff, including provenance for vendored material.
- Write commit bodies as prose, plus the one inventory the shape below calls for. Do not invent `Key: value` lines that resemble Git trailers.

### Body shape

Build the body so a reader can stop after any part and still know what they are looking at.

1. The motivation and the objective, both before anything else. What the code does today and why that is a problem, and what someone using the tool gets once this lands. Lead with whichever the change reads better from: a fix usually opens on the problem, a new capability often opens on what it gives.
2. A bulleted inventory of what the objective takes, one bullet per piece a reviewer would verify separately. Name the file or the identifier that carries each piece, so a bullet is somewhere to look rather than a claim. Keep a bullet to a line or two. Naming the entry point and where it is plumbed through to is enough, and a bullet that explains how something works belongs in the paragraphs below or nowhere. Between them the bullets account for everything in the diff, tests and incidental work included.
3. One paragraph per decision a reader could not reconstruct from the diff, which usually means an obvious alternative was rejected. Name the alternative and why it loses. A body that stops at the inventory is finished only when the change faced no such choice, so before stopping, say what a reviewer would ask why-not about. If there is an answer, it owes a paragraph however long the inventory above it ran.

Anything already legible in the diff or in `docs/**` stays out. A bullet restating what a function does, or a paragraph narrating a rename, is the diff written twice. Every claim has to be one the change itself supports. An alternative that `docs/**` raises and rejects is not something the code used to do: write it as the option that lost, never as a past state something was migrated away from.
