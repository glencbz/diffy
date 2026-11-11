// ~/~ begin <<docs/architecture/frontend/review.md#frontend-persistence-legacy-review>>[init]
import {
  EMPTY_REVIEW,
  isEmptyReview,
  ReviewDocument,
} from "../../model/review";
import { localRepository } from "./local";

const SESSION_KEY = "diffy.session.v1";

/** What this browser kept of the review before the server did, as one
 *  document, or null when it kept nothing. */
export function legacyReview(): ReviewDocument | null {
  const session = localRepository(
    SESSION_KEY,
    ReviewDocument,
    EMPTY_REVIEW,
  ).load();
  return isEmptyReview(session) ? null : session;
}

/** Forgets what `legacyReview` read, once the server holds it. */
export function clearLegacyReview(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // Left behind, it is imported again next time, which changes nothing.
  }
}
// ~/~ end
