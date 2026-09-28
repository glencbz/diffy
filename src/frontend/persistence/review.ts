// ~/~ begin <<docs/architecture/frontend/review.md#frontend-persistence-review>>[init]
import { EMPTY_REVIEW, ReviewDocument } from "../model/review";
import { localRepository } from "./local";

export const reviewRepository = localRepository<ReviewDocument>(
  "diffy.session.v1",
  ReviewDocument,
  EMPTY_REVIEW,
);
// ~/~ end
