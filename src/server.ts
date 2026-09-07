// ~/~ begin <<docs/architecture/backend/server.md#backend-server>>[init]

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
// ~/~ end
