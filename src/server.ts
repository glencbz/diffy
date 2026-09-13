// ~/~ begin <<docs/architecture/backend/server.md#backend-server>>[init]

import {
  JjError,
  jjCommits,
  jjDiff,
  jjInterdiff,
  jjLog,
  jjOpLog,
} from "./backend/commit/jj";
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
// ~/~ end
// ~/~ begin <<docs/architecture/backend/server.md#backend-server>>[1]

export async function handleInterdiff(req: Request): Promise<Response> {
  const params = new URL(req.url).searchParams;
  const from = params.get("from");
  const to = params.get("to");

  if (from === null && to === null) {
    return Response.json(
      { error: "interdiff needs a from or a to commit" },
      { status: 400 },
    );
  }

  return jjJson(async () => {
    const commits = await jjCommits([from, to].filter((id) => id !== null));
    const files =
      from !== null && to !== null
        ? await jjInterdiff({ from, to })
        : await jjDiff({ revision: from ?? to ?? "" });

    return {
      from: from === null ? null : (commits.get(from) ?? null),
      to: to === null ? null : (commits.get(to) ?? null),
      files,
    };
  });
}
// ~/~ end
// ~/~ begin <<docs/architecture/backend/server.md#backend-server>>[2]

export const routes = {
  "/": index,
  "/api/log": handleLog,
  "/api/operations": handleOperations,
  "/api/diff": handleDiff,
  "/api/interdiff": handleInterdiff,
};

if (import.meta.main) {
  const server = Bun.serve({ routes });
  console.log(`Listening on ${server.url}`);
}
// ~/~ end
