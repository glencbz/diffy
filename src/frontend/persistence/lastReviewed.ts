// ~/~ begin <<docs/architecture/frontend/pull-requests.md#frontend-persistence-last-reviewed>>[init]
import { LastReviewed } from "../model/lastReviewed";
import { localRepository, type Repository } from "./local";

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
