// ~/~ begin <<docs/architecture/frontend/index.md#frontend-persistence-local>>[init]
import type * as z from "zod";

/** Loads and saves one document the app keeps between visits. */
export interface Repository<T> {
  load(): T;
  save(document: T): void;
}

/** A document kept as JSON under one `localStorage` key. A read that finds
 * nothing it can parse returns `empty`, and a write that throws is dropped. */
export function localRepository<T>(
  key: string,
  schema: z.ZodType<T>,
  empty: T,
): Repository<T> {
  return {
    load() {
      const raw = localStorage.getItem(key);
      if (raw === null) return empty;

      try {
        return schema.parse(JSON.parse(raw));
      } catch {
        return empty;
      }
    },
    save(document) {
      try {
        localStorage.setItem(key, JSON.stringify(document));
      } catch {
        // Persistence failure is not worth a UI state.
      }
    },
  };
}
// ~/~ end
