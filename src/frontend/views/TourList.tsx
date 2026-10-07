// ~/~ begin <<docs/architecture/frontend/tour.md#frontend-view-tour-list>>[init]
export interface TourListItem {
  key: string;
  title: string;
  meta: string;
  /** Whether its newest version has a guide. */
  guided: boolean;
}

export function TourList({
  items,
  empty,
  onSelect,
}: {
  items: TourListItem[];
  empty: string;
  onSelect: (key: string) => void;
}) {
  if (items.length === 0) return <p className="message">{empty}</p>;
  return (
    <ul className="tour-list">
      {items.map((item) => (
        <li key={item.key}>
          <button
            type="button"
            className="tour-list__item"
            onClick={() => onSelect(item.key)}
          >
            <span className="tour-list__title">{item.title}</span>
            <span className="tour-list__meta">
              {item.meta}
              {item.guided && <span className="tour-list__guided">guided</span>}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
// ~/~ end
