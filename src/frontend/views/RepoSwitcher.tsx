// ~/~ begin <<docs/architecture/frontend/repos.md#frontend-view-repo-switcher>>[init]
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { pathParts, tildePath } from "../model/repo";

export function RepoSwitcher({
  home,
  current,
  open,
  onOpenChange,
  children,
}: {
  home: string;
  current: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The picker, drawn in the popover while it is open. */
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const [below, setBelow] = useState<CSSProperties>({});
  const shown = pathParts(tildePath(current, home));

  useLayoutEffect(() => {
    const box = button.current?.getBoundingClientRect();
    if (box) setBelow({ top: box.bottom + 4, left: Math.max(box.left, 8) });
  }, []);

  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) onOpenChange(false);
    };
    // Escape is heard on the document, since focus can leave the picker,
    // as when the Undo button it pressed goes away.
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open, onOpenChange]);

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "o") {
        event.preventDefault();
        onOpenChange(true);
      }
    };
    document.addEventListener("keydown", shortcut);
    return () => document.removeEventListener("keydown", shortcut);
  }, [onOpenChange]);

  return (
    <div className="repo-switcher" ref={root}>
      <button
        ref={button}
        type="button"
        className="repo-switcher__button"
        aria-expanded={open}
        aria-haspopup="dialog"
        title={`${tildePath(current, home)} (Ctrl+O to switch)`}
        onClick={() => onOpenChange(!open)}
      >
        <span className="repo-switcher__name">{shown.name}</span>
        <span className="repo-switcher__parent">{shown.parent}</span>
        <span className="repo-switcher__caret">▾</span>
      </button>
      {open && (
        <div className="repo-switcher__popover" role="dialog" style={below}>
          {children}
        </div>
      )}
    </div>
  );
}
// ~/~ end
