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

## Reviews in diffy

- The review branch server on port 4000 (see the `review-branch` skill) serves
  diffy's MCP tools to every session as the `diffy` server in `.mcp.json`.
- When a piece of work is done, `register_review` it under its bookmark and
  give Glen the link the tool returns, alongside the PR.
- Before changing work Glen has reviewed, `read_comments` on it. Answer with
  `add_comment` and `resolve_comment` what the change addresses.
- If the `diffy` tools are missing, :4000 is down. Run
  `.claude/skills/review-branch/review.sh start`, then ask Glen to reconnect
  with `/mcp`.

## Commit messages

- Before you write or reword any commit message, load the
  `commit-msg-style` skill and follow its `style.md`. It is the house style
  for subjects and bodies; nothing here restates or overrides it.
