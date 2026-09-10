// ~/~ begin <<docs/architecture/frontend.md#frontend-view-message>>[init]
import type { ReactNode } from "react";

export function Message({
  children,
  tone = "info",
}: {
  children: ReactNode;
  tone?: "info" | "error";
}) {
  return (
    <p style={{ padding: 12, color: tone === "error" ? "#cf222e" : "#333" }}>
      {children}
    </p>
  );
}
// ~/~ end
