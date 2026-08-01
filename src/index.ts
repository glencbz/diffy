// ~/~ begin <<docs/tech/bun.md#demo-bun>>[init]
const server = Bun.serve({
  port: 3000,
  routes: {
    "/": () => new Response("Bun!"),
    "/api/hello": () => Response.json({ message: "Hello, world!" }),
  },
});

console.log(`Listening on ${server.url}`);
// ~/~ end
