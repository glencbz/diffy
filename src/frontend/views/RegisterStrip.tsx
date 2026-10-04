// ~/~ begin <<docs/architecture/frontend/local-reviews.md#frontend-view-register-strip>>[init]
import type { FormEvent } from "react";

export function RegisterStrip({
  name,
  revset,
  action,
  busy,
  ready,
  ticked,
  outside,
  problem,
  registered,
  onName,
  onRevset,
  onRegister,
  onOpen,
  onClose,
}: {
  name: string;
  revset: string;
  /** What the button does, in words. */
  action: string;
  busy: boolean;
  ready: boolean;
  ticked: number;
  /** Commits the revset names that the graph does not draw. */
  outside: number;
  problem: string | null;
  /** The name the last registration went under. */
  registered: string | null;
  onName: (name: string) => void;
  onRevset: (revset: string) => void;
  onRegister: () => void;
  onOpen: (name: string) => void;
  onClose: () => void;
}) {
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onRegister();
  };

  return (
    <form onSubmit={submit} className="register-strip">
      <div className="register-strip__row">
        <span className="register-strip__count">
          {ticked === 1 ? "1 commit" : `${ticked} commits`}
        </span>
        <input
          value={name}
          onChange={(event) => onName(event.target.value)}
          placeholder="review name"
          aria-label="review name"
          className="register-strip__input"
        />
        <button
          type="submit"
          disabled={busy || !ready}
          className="register-strip__submit"
        >
          {action}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="register-strip__close"
        >
          close
        </button>
      </div>
      <input
        value={revset}
        onChange={(event) => onRevset(event.target.value)}
        placeholder="tick commits or type a revset"
        aria-label="revset"
        spellCheck={false}
        className="register-strip__input register-strip__revset"
      />
      {problem !== null && (
        <p role="alert" className="register-strip__problem">
          {problem}
        </p>
      )}
      {outside > 0 && (
        <p className="register-strip__note">
          {outside === 1
            ? "1 commit it names is not drawn here."
            : `${outside} commits it names are not drawn here.`}
        </p>
      )}
      {registered !== null && (
        <p className="register-strip__note">
          Registered {registered}.{" "}
          <button
            type="button"
            onClick={() => onOpen(registered)}
            className="register-strip__open"
          >
            open it
          </button>
        </p>
      )}
    </form>
  );
}
// ~/~ end
