// ~/~ begin <<docs/architecture/frontend/runs.md#frontend-view-network>>[init]
import { useState } from "react";
import type { Compared } from "../../model/runSteps";
import type { Request } from "../../model/runs";

export function Network({
  label,
  requests,
}: {
  /** The step the requests belong to. */
  label: string;
  requests: Compared<Request>[];
}) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="run-panel">
      <p className="run-panel__step">{label}</p>
      {requests.length === 0 ? (
        <p className="run-panel__none">No requests in this step.</p>
      ) : (
        <ul className="run-list">
          {requests.map((each, index) => {
            const request = (each.after ?? each.before) as Request;
            const key = `${index}:${request.method} ${request.url}`;
            const body = each.after?.body ?? each.before?.body ?? null;
            return (
              <li key={key} className={`run-row run-row--${each.change}`}>
                <button
                  type="button"
                  className="run-row__head"
                  aria-expanded={open === key}
                  disabled={body === null}
                  onClick={() => setOpen(open === key ? null : key)}
                >
                  <span className="run-row__change">
                    {CHANGE_MARK[each.change]}
                  </span>
                  <span className="run-row__method">{request.method}</span>
                  <span className="run-row__url">{request.url}</span>
                  <span className="run-row__status">
                    {each.change === "changed"
                      ? `${status(each.before)} → ${status(each.after)}`
                      : status(each.after ?? each.before)}
                  </span>
                  <span className="run-row__type">{request.type}</span>
                </button>
                {open === key && (
                  <div className="run-row__bodies">
                    {each.change === "changed" &&
                    each.before?.body !== each.after?.body ? (
                      <>
                        <Body title="parent" text={each.before?.body ?? null} />
                        <Body
                          title="this commit"
                          text={each.after?.body ?? null}
                        />
                      </>
                    ) : (
                      <Body title={null} text={body} />
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

const status = (request: Request | null) =>
  request === null ? "" : (request.status?.toString() ?? "failed");

function Body({ title, text }: { title: string | null; text: string | null }) {
  return (
    <figure className="run-body">
      {title !== null && <figcaption>{title}</figcaption>}
      <pre>{text === null ? "no answer kept" : pretty(text)}</pre>
    </figure>
  );
}

/** JSON laid out to read, anything else as it came. */
function pretty(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

export const CHANGE_MARK = {
  same: "",
  new: "+",
  gone: "−",
  changed: "~",
} as const;
// ~/~ end
