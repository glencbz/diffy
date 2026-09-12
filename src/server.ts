// ~/~ begin <<docs/architecture/backend/server.md#backend-server>>[init]

import { JjError, jjDiff, jjLog } from "./backend/commit/jj";
import index from "./frontend/index.html";

/** Run a jj-backed handler body; a rejected revset becomes a 400. */
async function jjJson(build: () => Promise<unknown>): Promise<Response> {
  try {
    return Response.json(await build());
  } catch (error) {
    if (error instanceof JjError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}

export function handleLog(): Promise<Response> {
  return jjJson(() => jjLog());
}

export function handleDiff(req: Request): Promise<Response> {
  const revision = new URL(req.url).searchParams.get("rev") ?? "@";
  return jjJson(async () => ({
    revision,
    files: await jjDiff({ revision }),
  }));
}

export const routes = {
  "/": index,
  "/api/log": handleLog,
  "/api/diff": handleDiff,
};

if (import.meta.main) {
  const server = Bun.serve({ port: 3000, routes });
  console.log(`Listening on ${server.url}`);
}
// ~/~ end
