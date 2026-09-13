// Verification launcher: serve the real routes from src/server.ts on an
// ephemeral port so a verification run never fights the port-3000 instance a
// developer (or the exe.dev preview) may already have running.
//
// Not tangled from docs/: this is verification scaffolding, not app source.

import { routes } from "../../../../src/server";

const server = Bun.serve({ hostname: "127.0.0.1", port: 0, routes });
console.log(`Listening on ${server.url}`);
