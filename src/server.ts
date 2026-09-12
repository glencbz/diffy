// ~/~ begin <<docs/architecture/backend/server.md#backend-server>>[init]

import { JjError, jjDiff, jjLog, jjOpLog } from "./backend/commit/jj";
import index from "./frontend/index.html";

/** Run a jj-backed handler body; a rejected revset/operation becomes a 400. */
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

export function handleLog(req: Request): Promise<Response> {
  const atOperation = new URL(req.url).searchParams.get("op") ?? undefined;
  return jjJson(() => jjLog({ atOperation }));
}

export function handleOperations(): Promise<Response> {
  return jjJson(() => jjOpLog({ limit: 200 }));
}

export function handleDiff(req: Request): Promise<Response> {
  const params = new URL(req.url).searchParams;
  const revision = params.get("rev") ?? "@";
  const atOperation = params.get("op") ?? undefined;
  return jjJson(async () => ({
    revision,
    files: await jjDiff({ revision, atOperation }),
  }));
}

export const routes = {
  "/": index,
  "/api/log": handleLog,
  "/api/operations": handleOperations,
  "/api/diff": handleDiff,
};

if (import.meta.main) {
  const server = Bun.serve({ port: 3000, routes });
  console.log(`Listening on ${server.url}`);
}
// ~/~ end
