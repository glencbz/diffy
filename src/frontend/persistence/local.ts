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

      // Absent, truncated by a full quota, or hand-edited: costs the reader
      // what was stored, not the ability to open the app. A field added later
      // needs a schema default, or every older document reads as bad.
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
        // Safari private browsing and full quotas throw, and the caller is a
        // click handler with no error channel. Keep working for this tab.
      }
    },
  };
}
// ~/~ end
