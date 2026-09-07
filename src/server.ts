// ~/~ begin <<docs/architecture/backend/server.md#backend-server>>[init]

import { JjError, jjDiff, jjLog } from "./backend/commit/jj";
import index from "./frontend/index.html";

/**
 * `GET /api/diff?rev=<revision>` — one revision's diff, file by file.
 *
 * A `JjError` means jj rejected the revision, so it maps to 400 with jj's own
 * message. Any other error is unexpected and propagates as a 500.
 */
export async function handleDiff(req: Request): Promise<Response> {
  const revision = new URL(req.url).searchParams.get("rev") ?? "@";
  try {
    return Response.json({ revision, files: await jjDiff({ revision }) });
  } catch (error) {
    if (error instanceof JjError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}

export const routes = {
  "/": index,
  "/api/log": async () => Response.json(await jjLog()),
  "/api/diff": handleDiff,
};

if (import.meta.main) {
  const server = Bun.serve({ port: 3000, routes });
  console.log(`Listening on ${server.url}`);
}
// ~/~ end
