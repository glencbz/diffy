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
    "/": () => new Response('Bun!'),
  }
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
