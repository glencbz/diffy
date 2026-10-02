// Verification launcher: serve the real routes from src/server.ts on an
// ephemeral port so a verification run never fights the port-3000 instance a
// developer (or the exe.dev preview) may already have running.
//
// Not tangled from docs/: this is verification scaffolding, not app source.

import { openReviewStore, watchReview } from "../../../../src/backend/review/store";
import { REVIEW_TOPIC, reviewSocket, routes } from "../../../../src/server";

// The review store lives in the run directory verify.sh passes, not under
// $XDG_DATA_HOME like `diffy` keeps it, so `stop` removes it with the fixture.
const storePath = Bun.argv[2];
if (!storePath) throw new Error("usage: serve.ts <review-store-path>");

const store = openReviewStore(storePath);
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  routes: routes(store),
  websocket: reviewSocket,
});
watchReview(store, (revision) =>
  server.publish(REVIEW_TOPIC, JSON.stringify({ revision })),
);
console.log(`Listening on ${server.url}`);
