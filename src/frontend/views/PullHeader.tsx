// ~/~ begin <<docs/architecture/frontend/pull-requests.md#frontend-view-pull-header>>[init]
import type { PullSummary } from "../api";
import { PullStateChip } from "./PullStateChip";

export function PullHeader({ pull }: { pull: PullSummary }) {
  return (
    <header className="pull-header">
      <span className="pull-header__meta">#{pull.number}</span>
      <strong className="pull-header__title">{pull.title}</strong>
      <PullStateChip state={pull.state} />
      <span className="pull-header__meta">base: {pull.baseRefName}</span>
      <span className="pull-header__meta">{pull.author}</span>
      <a
        href={pull.url}
        target="_blank"
        rel="noreferrer"
        className="pull-header__link"
      >
        github
      </a>
    </header>
  );
}
// ~/~ end
