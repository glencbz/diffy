// ~/~ begin <<docs/architecture/frontend/review.md#frontend-persistence-legacy-review>>[init]
import { LastReviewed } from "../model/lastReviewed";
import {
  EMPTY_REVIEW,
  isEmptyReview,
  ReviewDocument,
  type ReviewedVersion,
} from "../model/review";
import { localRepository } from "./local";

const SESSION_KEY = "diffy.session.v1";
const LAST_REVIEWED_PREFIX = "diffy.last-reviewed.v1:";

function lastReviewedKeys(): string[] {
  const keys: string[] = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key?.startsWith(LAST_REVIEWED_PREFIX)) keys.push(key);
  }
  return keys;
}

/** What this browser kept of the review before the server did, as one
 *  document, or null when it kept nothing. A pull request's last reviewed
 *  head becomes a version marked reviewed at `now`, since the browser never
 *  kept when it was marked. */
export function legacyReview(now: string): ReviewDocument | null {
  const session = localRepository(
    SESSION_KEY,
    ReviewDocument,
    EMPTY_REVIEW,
  ).load();
  const reviewed = lastReviewedKeys().flatMap((key): ReviewedVersion[] => {
    const mark = localRepository(key, LastReviewed, null).load();
    if (mark === null) return [];
    const series = `pull:${key.slice(LAST_REVIEWED_PREFIX.length)}`;
    return [{ series, version: mark.head, reviewedAt: now }];
  });
  const document = { ...session, reviewed };
  return isEmptyReview(document) ? null : document;
}

/** Forgets what `legacyReview` read, once the server holds it. */
export function clearLegacyReview(): void {
  for (const key of [SESSION_KEY, ...lastReviewedKeys()]) {
    try {
      localStorage.removeItem(key);
    } catch {
      // Left behind, it is imported again next time, which changes nothing.
    }
  }
}
// ~/~ end
