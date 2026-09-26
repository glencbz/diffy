// ~/~ begin <<docs/architecture/frontend/pull-requests.md#frontend-persistence-last-reviewed>>[init]
import * as z from "zod";
import { GitOid } from "../api";
import { localRepository, type Repository } from "./local";

const LastReviewed = z.object({ head: GitOid });
type LastReviewed = z.infer<typeof LastReviewed>;

/** The head this reader last marked reviewed on one pull request. */
export function lastReviewedRepository(
  repo: string,
  number: number,
): Repository<LastReviewed | null> {
  return localRepository<LastReviewed | null>(
    `diffy.last-reviewed.v1:${repo}#${number}`,
    LastReviewed,
    null,
  );
}
// ~/~ end
