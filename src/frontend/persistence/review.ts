// ~/~ begin <<docs/architecture/frontend/review.md#frontend-persistence-review>>[init]
import * as z from "zod";
import { type ReviewCommand, ReviewSnapshot } from "../model/review";

const ErrorAnswer = z.object({ error: z.string() });

/** The server's answer, or the error it gave in its place. */
async function snapshotOf(res: Response): Promise<ReviewSnapshot> {
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const error = ErrorAnswer.safeParse(body);
    throw new Error(
      error.success
        ? error.data.error
        : `the review store answered ${res.status}`,
    );
  }
  return ReviewSnapshot.parse(body);
}

/** The review document as the server keeps it. */
export const reviewStore = {
  async load(): Promise<ReviewSnapshot> {
    return snapshotOf(await fetch("/api/review"));
  },
  async send(command: ReviewCommand): Promise<ReviewSnapshot> {
    return snapshotOf(
      await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(command),
      }),
    );
  },
};
// ~/~ end
