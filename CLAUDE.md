---
description: Use Bun instead of Node.js, npm, pnpm, or vite.
globs: "*.ts, *.tsx, *.html, *.css, *.js, *.jsx, package.json"
alwaysApply: false
---

Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
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

Use `bun test` to run tests.

```ts#index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

## Frontend

Use HTML imports with `Bun.serve()`. Don't use `vite`. HTML imports fully support React, CSS, Tailwind.

Server:

```ts#index.ts
import index from "./index.html"

Bun.serve({
  routes: {
    "/": index,
    "/api/users/:id": {
      GET: (req) => {
        return new Response(JSON.stringify({ id: req.params.id }));
      },
    },
  },
  // optional websocket support
  websocket: {
    open: (ws) => {
      ws.send("Hello, world!");
    },
    message: (ws, message) => {
      ws.send(message);
    },
    close: (ws) => {
      // handle close
    }
  },
  development: {
    hmr: true,
    console: true,
  }
})
```

HTML files can import .tsx, .jsx or .js files directly and Bun's bundler will transpile & bundle automatically. `<link>` tags can point to stylesheets and Bun's CSS bundler will bundle.

```html#index.html
<html>
  <body>
    <h1>Hello, world!</h1>
    <script type="module" src="./frontend.tsx"></script>
  </body>
</html>
```

With the following `frontend.tsx`:

```tsx#frontend.tsx
import React from "react";
import { createRoot } from "react-dom/client";

// import .css files directly and it works
import './index.css';

const root = createRoot(document.body);

export default function Frontend() {
  return <h1>Hello, world!</h1>;
}

root.render(<Frontend />);
```

Then, run index.ts

```sh
bun --hot ./index.ts
```

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.mdx`.

## Version control

- This repo is jj-backed (colocated jj + Git). Use `jj`, not `git`, for
  everyday work. See the `jj` skill.
- Never create a `git worktree`. jj cannot see edits made in one, so they are
  never snapshotted. Two guards in `.claude/settings.json`:
  - `worktree.bgIsolation: "none"` — background sessions edit the main checkout
    directly instead of being forced into isolation.
  - `WorktreeCreate` / `WorktreeRemove` hooks — when isolation *is* requested
    (`--worktree`, `EnterWorktree`, agent `isolation: "worktree"`), the hooks
    provision a **jj workspace** under `.claude/worktrees/<name>`, not a git
    worktree. The `SessionStart` hook warns if one slips through anyway.
- For an isolated working copy by hand, use
  `jj workspace add .claude/worktrees/<name>` and `cd` into it so edits land in
  that workspace, not `default`. Otherwise just work in the main checkout on a
  jj change, adding a Git bookmark at the PR boundary.

## GitHub workflow

- Finish every requested change on a dedicated branch, commit it, push it, and open a GitHub pull request. Do not commit directly to `main`.

## Commit messages

- Prefix commit subjects with the affected subarea (for example, `skills:`), not Conventional Commit types such as `feat:`, `fix:`, or `chore:`.
- Wrap commit messages at 72 characters.
- Use the commit body for useful context that is not obvious from the diff, including provenance for vendored material.
- Write commit bodies as regular prose. Do not invent `Key: value` lines that resemble Git trailers.
