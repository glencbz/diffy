// ~/~ begin <<docs/architecture/frontend/local-history.md#frontend-view-operation-picker>>[init]
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import type { OpLogEntry } from "../model/history";

export function OperationPicker({
  operations,
  selected,
  onSelect,
  children,
}: {
  operations: OpLogEntry[];
  selected: string | null;
  onSelect: (operationId: string | null) => void;
  /** Controls that sit on the picker's row after the field. */
  children?: ReactNode;
}) {
  const id = useId();
  const list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const choices: (string | null)[] = [null, ...operations.map((op) => op.id)];
  const at = Math.max(0, choices.indexOf(selected));
  const [active, setActive] = useState(at);
  const current = operations.find((operation) => operation.id === selected);

  useEffect(() => {
    if (!open) return;
    list.current?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    document
      .getElementById(`${id}-${active}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [open, active, id]);

  const show = () => {
    setActive(at);
    setOpen(true);
  };
  const pick = (index: number) => {
    setOpen(false);
    const choice = choices[index];
    if (choice !== undefined && choice !== selected) onSelect(choice);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const last = choices.length - 1;
    const moves: Record<string, number> = {
      ArrowDown: Math.min(active + 1, last),
      ArrowUp: Math.max(active - 1, 0),
      Home: 0,
      End: last,
    };
    const move = moves[event.key];
    if (move !== undefined) setActive(move);
    else if (event.key === "Enter" || event.key === " ") pick(active);
    else if (event.key === "Escape") setOpen(false);
    else return;
    event.preventDefault();
  };

  return (
    <div className="operation-picker">
      <div className="operation-picker__field">
        <span className="operation-picker__label" id={`${id}-label`}>
          operation
        </span>
        <button
          type="button"
          role="combobox"
          aria-labelledby={`${id}-label`}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          title={current === undefined ? undefined : optionLabel(current)}
          onClick={() => (open ? setOpen(false) : show())}
          className="operation-picker__trigger"
        >
          {current === undefined ? (
            <OptionText what="latest (current)" />
          ) : (
            <OperationText operation={current} />
          )}
        </button>
        {open && (
          <>
            <button
              type="button"
              aria-label="close the operation list"
              tabIndex={-1}
              onClick={() => setOpen(false)}
              className="operation-picker__scrim"
            />
            <div
              ref={list}
              id={`${id}-list`}
              role="listbox"
              aria-labelledby={`${id}-label`}
              aria-activedescendant={`${id}-${active}`}
              tabIndex={-1}
              onKeyDown={onKeyDown}
              className="operation-picker__list"
            >
              {choices.map((choice, index) => {
                const operation = operations[index - 1];
                return (
                  // biome-ignore lint/a11y/useKeyWithClickEvents: the listbox handles keys for its options
                  <div
                    key={choice ?? ""}
                    id={`${id}-${index}`}
                    role="option"
                    aria-selected={choice === selected}
                    tabIndex={-1}
                    title={
                      operation === undefined
                        ? undefined
                        : optionLabel(operation)
                    }
                    aria-label={
                      operation === undefined
                        ? undefined
                        : optionLabel(operation)
                    }
                    onClick={() => pick(index)}
                    onMouseMove={() => setActive(index)}
                    className={
                      index === active
                        ? "operation-picker__option operation-picker__option--active"
                        : "operation-picker__option"
                    }
                  >
                    {operation === undefined ? (
                      <OptionText what="latest (current)" />
                    ) : (
                      <OperationText operation={operation} />
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
      {children}
    </div>
  );
}

function OperationText({ operation }: { operation: OpLogEntry }) {
  return (
    <OptionText
      id={operation.id.slice(0, 8)}
      what={operation.description || operation.args}
      when={operation.time.slice(5, 16).replace("T", " ")}
    />
  );
}

function OptionText({
  id,
  what,
  when,
}: {
  id?: string;
  what: string;
  when?: string;
}) {
  return (
    <>
      {id !== undefined && <span className="operation-picker__id">{id}</span>}
      <span className="operation-picker__what">{what}</span>
      {when !== undefined && (
        <span className="operation-picker__when">{when}</span>
      )}
    </>
  );
}

export function optionLabel(operation: OpLogEntry): string {
  const when = operation.time.slice(0, 19).replace("T", " ");
  const what = operation.description || operation.args;
  return `${operation.id.slice(0, 8)}  ${what}  ${when}`;
}
// ~/~ end
