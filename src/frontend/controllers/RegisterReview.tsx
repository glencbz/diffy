// ~/~ begin <<docs/architecture/frontend/local-reviews.md#frontend-controller-register-review>>[init]
import { useEffect, useRef, useState } from "react";
import { localReview } from "../model/review";
import { reviewNameFor, revsetFor } from "../model/revset";
import { useCommits } from "../state/commits";
import { register, useRevsetMatch, useTrunk } from "../state/registration";
import { useReviewContext } from "../state/review";
import { RegisterStrip } from "../views/RegisterStrip";

export function RegisterReview({
  operation,
  ticked,
  onTick,
  onOpen,
  onClose,
}: {
  operation: string;
  ticked: string[];
  onTick: (commitIds: string[]) => void;
  onOpen: (name: string) => void;
  onClose: () => void;
}) {
  const log = useCommits({ kind: "jj", operation });
  const review = useReviewContext();
  const [typed, setTyped] = useState<string | null>(null);
  const [named, setNamed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [registered, setRegistered] = useState<string | null>(null);
  const match = useRevsetMatch(operation, typed);
  const trunk = useTrunk(operation);
  const applied = useRef<string[] | null>(null);

  const entries = log.status === "ready" ? log.data : [];
  const matched = match?.status === "ready" ? new Set(match.data) : null;
  const inGraph =
    matched === null
      ? []
      : entries
          .filter((commit) => matched.has(commit.commitId))
          .map((commit) => commit.commitId);

  // A typed revset's answer ticks what it names.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a new answer re-ticks
  useEffect(() => {
    if (matched === null) return;
    applied.current = inGraph;
    onTick(inGraph);
  }, [match]);

  // A tick the reader made hands the revset back to the ticks.
  useEffect(() => {
    const ours = applied.current;
    if (ours === null) return;
    if (
      ours.length === ticked.length &&
      ours.every((id, i) => id === ticked[i])
    ) {
      return;
    }
    applied.current = null;
    setTyped(null);
  }, [ticked]);

  // What was registered stops describing the strip once the series moves.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a change to either clears it
  useEffect(() => setRegistered(null), [ticked, operation]);

  const revset = typed ?? revsetFor(entries, ticked, trunk);
  const name = named ?? reviewNameFor(entries, ticked);
  const existing =
    review.status === "loading"
      ? undefined
      : localReview(review.document, name);
  const replaces =
    existing?.versions.findIndex((kept) => kept.operation === operation) ?? -1;
  const action =
    existing === undefined
      ? "create review"
      : replaces === -1
        ? `add v${existing.versions.length + 1} to ${name}`
        : `replace v${replaces + 1} of ${name}`;

  return (
    <RegisterStrip
      name={name}
      revset={revset}
      action={action}
      busy={busy}
      ready={
        name.trim() !== "" && revset.trim() !== "" && match?.status !== "error"
      }
      ticked={ticked.length}
      outside={matched === null ? 0 : matched.size - inGraph.length}
      problem={match?.status === "error" ? match.message : failure}
      registered={registered}
      onName={(next) => {
        setNamed(next);
        setRegistered(null);
      }}
      onRevset={(next) => {
        setTyped(next);
        setRegistered(null);
      }}
      onRegister={() => {
        setBusy(true);
        setFailure(null);
        register({ name: name.trim(), revset: revset.trim(), operation })
          .then(setRegistered, (err: unknown) =>
            setFailure(err instanceof Error ? err.message : String(err)),
          )
          .finally(() => setBusy(false));
      }}
      onOpen={onOpen}
      onClose={onClose}
    />
  );
}
// ~/~ end
