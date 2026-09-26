// ~/~ begin <<docs/architecture/frontend/review-tracking.md#frontend-persistence-session>>[init]
import { SessionDocument } from "../model/review";
import { localRepository } from "./local";

export const sessionRepository = localRepository<SessionDocument>(
  "diffy.session.v1",
  SessionDocument,
  { marks: [], comments: [], viewed: [] },
);
// ~/~ end
