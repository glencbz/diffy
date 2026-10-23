// ~/~ begin <<docs/architecture/frontend/panels.md#frontend-persistence-layouts>>[init]
import { LayoutsDocument } from "../model/panels";

export const layoutsStore = {
  async load(): Promise<LayoutsDocument> {
    const res = await fetch("/api/layouts");
    if (!res.ok) throw new Error(`the layout store answered ${res.status}`);
    return LayoutsDocument.parse(await res.json());
  },
  async save(document: LayoutsDocument): Promise<void> {
    const res = await fetch("/api/layouts", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(document),
    });
    if (!res.ok) throw new Error(`the layout store answered ${res.status}`);
  },
};
// ~/~ end
