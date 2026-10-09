// ~/~ begin <<docs/architecture/frontend/components.md#frontend-view-components-icons>>[init]
/** Line icons drawn in the text's colour, at its size. */
export function CommentIcon() {
  return (
    <svg className="components-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z" />
    </svg>
  );
}

export function MessageIcon() {
  return (
    <svg className="components-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 4h10M3 7h10M3 10h6" />
    </svg>
  );
}

export function SwapIcon() {
  return (
    <svg className="components-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 5.5h9.5l-2.5-2.5M13 10.5h-9.5l2.5 2.5" />
    </svg>
  );
}
// ~/~ end
