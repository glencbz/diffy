// ~/~ begin <<docs/bun.md#demo-bun>>[init]
const server = Bun.serve({
  port: 3000,
  routes: {
    "/": () => new Response('Bun!'),
  }
});

console.log(`Listening on ${server.url}`);
// ~/~ end
