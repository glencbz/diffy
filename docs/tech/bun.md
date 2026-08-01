# Bun

Why Bun? Because it seems pretty productive. It gives a batteries-included way
to do bundling, testing, serving... It works with ts, it works with npm, I
think that's pretty crazy.

## Install

```just
#| id: just-bun-install
bun install
```

## Backend API

To start, let's create an entrypoint for our Bun work.

```ts
//| id: demo-bun
//| file: src/index.ts
const server = Bun.serve({
  port: 3000,
  routes: {
    "/": () => new Response("Bun!"),
    "/api/hello": () => Response.json({ message: "Hello, world!" }),
  },
});

console.log(`Listening on ${server.url}`);
```

And a just recipe to run it.

```just
#| id: just-bun
# Run the app
@run:
  bun run src/index.ts

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

# Format code in place
@format:
  bunx biome format --write .
```
