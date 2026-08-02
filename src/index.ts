// ~/~ begin <<docs/tech/bun.md#demo-bun>>[init]
import index from "./index.html";

const server = Bun.serve({
  port: 3000,
  routes: {
    "/": index,
    "/api/hello": () => Response.json({ message: "Hello, world!" }),
  },
});

console.log(`Listening on ${server.url}`);
// ~/~ end
