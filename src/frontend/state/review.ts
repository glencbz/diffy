// ~/~ begin <<docs/architecture/frontend/review.md#frontend-state-review>>[init]
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { AsyncState } from "../model/asyncState";
import {
  applyCommand,
  type ComparisonReview,
  commentOn,
  EMPTY_REVIEW,
  keepKey,
  markSeen,
  markViewed,
  type ReviewActions,
  type ReviewCommand,
  type ReviewDocument,
  type ReviewSnapshot,
} from "../model/review";
import { clearLegacyReview, legacyReview } from "../persistence/legacyReview";
import { reviewStore } from "../persistence/review";

/** The review document and what a screen can do with it. Only a document
 *  the server has answered with can be changed, so `actions` exists only
 *  once it is ready. */
export type ReviewHandle = (
  | { status: "loading" }
  | { status: "unavailable"; message: string }
  | { status: "ready"; actions: ReviewActions }
) & {
  /** The server's document with every command still in flight applied. */
  document: ReviewDocument;
  /** Why the last change could not be saved, until the reader dismisses it. */
  failure: string | null;
  dismissFailure: () => void;
};

interface Pending {
  id: number;
  command: ReviewCommand;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useReview(): ReviewHandle {
  const [confirmed, setConfirmed] = useState<AsyncState<ReviewSnapshot>>({
    status: "loading",
  });
  const [pending, setPending] = useState<Pending[]>([]);
  const [failure, setFailure] = useState<string | null>(null);
  const nextId = useRef(0);

  // Answers can arrive out of order, and an older one would undo a newer
  // one's command on screen, so only a higher revision replaces what is held.
  const accept = useCallback((snapshot: ReviewSnapshot) => {
    setConfirmed((now) =>
      now.status === "ready" && now.data.revision >= snapshot.revision
        ? now
        : { status: "ready", data: snapshot },
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let snapshot = await reviewStore.load();
      const legacy = legacyReview(new Date().toISOString());
      if (legacy !== null) {
        snapshot = await reviewStore.send({ kind: "import", document: legacy });
        clearLegacyReview();
      }
      if (!cancelled) accept(snapshot);
    })().catch((error: unknown) => {
      if (!cancelled) {
        setConfirmed({ status: "error", message: messageOf(error) });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [accept]);

  // Another writer's change reaches this screen as an announced revision.
  // One this screen already holds needs no read.
  const held = confirmed.status === "ready" ? confirmed.data.revision : -1;
  const heldRef = useRef(held);
  heldRef.current = held;
  useEffect(
    () =>
      reviewStore.watch((revision) => {
        if (revision !== null && revision <= heldRef.current) return;
        reviewStore.load().then(accept, () => {});
      }),
    [accept],
  );

  const actions = useMemo<ReviewActions>(() => {
    const now = () => new Date().toISOString();
    const send = (command: ReviewCommand) => {
      const id = nextId.current;
      nextId.current += 1;
      const settle = () =>
        setPending((all) => all.filter((entry) => entry.id !== id));
      setPending((all) => [...all, { id, command }]);
      reviewStore.send(command).then(
        (snapshot) => {
          accept(snapshot);
          settle();
        },
        (error: unknown) => {
          settle();
          setFailure(`Could not save that change: ${messageOf(error)}`);
        },
      );
    };
    const write = (row: ComparisonReview, command: ReviewCommand) => {
      for (const kept of keepKey(row)) send(kept);
      send(command);
    };
    return {
      markSeen: (row) => write(row, markSeen(row, now())),
      addComment: (row, anchor, body) =>
        write(
          row,
          commentOn(row, {
            id: crypto.randomUUID(),
            ...anchor,
            body,
            createdAt: now(),
            author: "reader",
          }),
        ),
      editComment: (id, body) => send({ kind: "edit-comment", id, body }),
      resolveComment: (id, resolved) =>
        send({ kind: "resolve-comment", id, resolved }),
      dropComment: (id) => send({ kind: "delete-comment", id }),
      replyToComment: (id, body) =>
        send({
          kind: "add-reply",
          commentId: id,
          reply: {
            id: crypto.randomUUID(),
            body,
            createdAt: now(),
            author: "reader",
          },
        }),
      editReply: (commentId, replyId, body) =>
        send({ kind: "edit-reply", commentId, replyId, body }),
      dropReply: (commentId, replyId) =>
        send({ kind: "delete-reply", commentId, replyId }),
      toggleViewed: (row, file) => write(row, markViewed(row, file, now())),
      compare: (row, newPath, oldPath) =>
        write(row, {
          kind: "set-compared",
          reviewKey: row.reviewKey,
          newPath,
          oldPath,
        }),
      markReviewed: (series, version) =>
        send({ kind: "mark-reviewed", series, version, at: now() }),
      keepPairing: (series, before, after, slots) =>
        send({ kind: "set-pairing", series, before, after, slots }),
      forgetReview: (name) => send({ kind: "forget-review", name, at: now() }),
      restoreReview: (name) => send({ kind: "restore-review", name }),
    };
  }, [accept]);

  const dismissFailure = useCallback(() => setFailure(null), []);
  const shared = { failure, dismissFailure };

  if (confirmed.status === "loading") {
    return { status: "loading", document: EMPTY_REVIEW, ...shared };
  }
  if (confirmed.status === "error") {
    return {
      status: "unavailable",
      message: confirmed.message,
      document: EMPTY_REVIEW,
      ...shared,
    };
  }
  return {
    status: "ready",
    actions,
    document: pending.reduce(
      (document, entry) => applyCommand(document, entry.command),
      confirmed.data.document,
    ),
    ...shared,
  };
}
// ~/~ end
// ~/~ begin <<docs/architecture/frontend/review.md#frontend-state-review>>[1]

export const ReviewContext = createContext<ReviewHandle | null>(null);

export function useReviewContext(): ReviewHandle {
  const review = useContext(ReviewContext);
  if (review === null) throw new Error("no ReviewContext above this screen");
  return review;
}
// ~/~ end
