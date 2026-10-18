// ~/~ begin <<docs/architecture/frontend/components.md#frontend-view-components-groups>>[init]
import type { Arrangement, Group } from "../../model/groups";

/** How far the reader has put a group away: its runs, and those seen. */
export interface GroupCount {
  folds: number;
  seen: number;
}

export function Groups({
  arrangement,
  arrangements,
  groups,
  counts,
  links,
  focus,
  preview,
  only,
  onArrange,
  onFocus,
  onPreview,
  onOnly,
}: {
  arrangement: Arrangement;
  arrangements: Arrangement[];
  groups: Group[];
  counts: ReadonlyMap<string, GroupCount>;
  links: ReadonlyMap<string, { uses: Group[]; usedBy: Group[] }>;
  /** The focused group's id. */
  focus: string | null;
  /** The group pointed at, which the description shows over the focus. */
  preview: string | null;
  /** Whether the list drops the other groups' components or dims them. */
  only: boolean;
  onArrange: (arrangement: Arrangement) => void;
  onFocus: (id: string | null) => void;
  onPreview: (id: string | null) => void;
  onOnly: (only: boolean) => void;
}) {
  const shown = preview ?? focus;
  const countOf = (group: Group) => {
    const count = counts.get(group.id) ?? { folds: 0, seen: 0 };
    return count.folds === 0
      ? "–"
      : count.seen === count.folds
        ? "✓"
        : `${count.seen}/${count.folds}`;
  };
  // Pointing previews and clicking focuses, so one handler set serves the
  // bar's segment and the legend's entry alike.
  const handlers = (group: Group) => ({
    "aria-pressed": focus === group.id,
    onMouseEnter: () => onPreview(group.id),
    onMouseLeave: () => onPreview(null),
    onClick: () => onFocus(focus === group.id ? null : group.id),
  });
  const colour = (index: number) => `components-group--${index % 8}`;
  const named = (other: Group) => (
    <button
      type="button"
      key={other.id}
      className={`components-groups__link ${colour(groups.indexOf(other))}`}
      onClick={() => onFocus(other.id)}
    >
      {other.name}
    </button>
  );
  const list = (each: Group[]) =>
    each.flatMap((other, index) => [
      ...(index === 0 ? [] : [", "]),
      named(other),
    ]);
  return (
    <div className="components-groups">
      <div className="components-groups__head">
        <label className="components-groups__arrange">
          grouped by
          <select
            value={arrangement}
            onChange={(event) =>
              onArrange(event.currentTarget.value as Arrangement)
            }
          >
            {arrangements.map((each) => (
              <option key={each} value={each}>
                {each}
              </option>
            ))}
          </select>
        </label>
        <span className="components-groups__show">
          {(
            [
              [false, "dim the rest"],
              [true, "only these"],
            ] as const
          ).map(([value, label]) => (
            <button
              type="button"
              key={label}
              aria-pressed={only === value}
              onClick={() => onOnly(value)}
            >
              {label}
            </button>
          ))}
        </span>
      </div>
      <div className="components-groups__bar">
        {groups.map((group, index) => {
          const count = counts.get(group.id) ?? { folds: 0, seen: 0 };
          // A group the comparison draws nothing of has no length; the
          // legend still names it.
          if (count.folds === 0) return null;
          return (
            <button
              type="button"
              key={group.id}
              className={`components-groups__segment ${colour(index)}`}
              style={{ flexGrow: count.folds }}
              title={`${group.name}: ${count.seen} of ${count.folds} seen`}
              {...handlers(group)}
            >
              <span
                style={{
                  width: `${(100 * count.seen) / Math.max(1, count.folds)}%`,
                }}
              />
            </button>
          );
        })}
      </div>
      <div className="components-groups__legend">
        {groups.map((group, index) => (
          <button
            type="button"
            key={group.id}
            className={`components-groups__entry ${colour(index)}`}
            {...handlers(group)}
          >
            <span className="components-groups__swatch" />
            <span className="components-groups__name">{group.name}</span>
            <span className="components-groups__count">{countOf(group)}</span>
          </button>
        ))}
      </div>
      <div className="components-groups__about">
        {[null, ...groups].map((group) => {
          const on = (group?.id ?? null) === shown;
          const { uses, usedBy } =
            group === null
              ? { uses: [], usedBy: [] }
              : (links.get(group.id) ?? { uses: [], usedBy: [] });
          return (
            <div
              key={group?.id ?? ""}
              aria-hidden={!on}
              inert={!on}
              style={{ visibility: on ? "visible" : "hidden" }}
            >
              {group === null ? (
                <p>Pick a {arrangement} to see only its code.</p>
              ) : (
                <>
                  <p>{group.gist === "" ? group.name : group.gist}</p>
                  <p className="components-groups__links">
                    {uses.length > 0 && <span>Uses {list(uses)}. </span>}
                    {usedBy.length > 0 && <span>Used by {list(usedBy)}.</span>}
                    {uses.length === 0 && usedBy.length === 0 && (
                      <span>Uses no other {arrangement}.</span>
                    )}
                  </p>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
// ~/~ end
