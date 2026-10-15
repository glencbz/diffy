// ~/~ begin <<docs/architecture/frontend/layout.md#frontend-view-drawer-tabs>>[init]
export type DrawerTab = "commits" | "threads";

export function DrawerTabs({
  tab,
  onTab,
  openThreads,
}: {
  tab: DrawerTab;
  onTab: (tab: DrawerTab) => void;
  openThreads: number;
}) {
  return (
    <div className="drawer-tabs" role="tablist">
      <button
        type="button"
        role="tab"
        aria-selected={tab === "commits"}
        onClick={() => onTab("commits")}
        className="drawer-tab"
      >
        Commits
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={tab === "threads"}
        onClick={() => onTab("threads")}
        className="drawer-tab"
      >
        Threads
        {openThreads > 0 && (
          <span className="drawer-tab__count">{openThreads} open</span>
        )}
      </button>
    </div>
  );
}
// ~/~ end
