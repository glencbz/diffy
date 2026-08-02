# Backend

## Web server

As with all our components, we add a just rule to run the backend:

```just
#| id: just-bun
# Run the app
@run:
  bun run src/server.ts

```

The entrypoint will be a single ts file with a web server.

```ts
//| id: backend-server
//| file: src/server.ts

import { jjLog } from "./backend/commit/jj";
import index from "./frontend/index.html";

const server = Bun.serve({
  port: 3000,
  routes: {
    "/": index,
    "/api/log": async () => Response.json(await jjLog()),
  },
});

console.log(`Listening on ${server.url}`);
```

## Quality

### Testing

`bun test` is our test runner. Having fewer deps is nice.

```just
#| id: just-bun-test
# Run tests
@test:
  bun test
```

### Typechecking

Bun transpiles TS by stripping types, it doesn't check them, so we still
need `tsc --noEmit` (config in `tsconfig.json`) as a separate check.

```just
#| id: just-bun-typecheck
# Typecheck without emitting
@typecheck:
  bunx tsc --noEmit
```

### Linting & formatting

[Biome](https://biomejs.dev/) is our linter/formatter. It's faster and easier than 
ESLint + Prettier. We used the default `bunx biome init`.

```just
#| id: just-biome
# Lint and check formatting/import order
@lint:
  bunx biome check .

# Lint and apply automatic fixes
@lint-fix:
  bunx biome check . --fix

# Format code in place
@format:
  bunx biome format --write .
```
