// ~/~ begin <<docs/architecture/frontend/index.md#frontend-persistence-memory-storage>>[init]
export function memoryStorage(): Pick<
  Storage,
  "getItem" | "setItem" | "removeItem" | "key" | "length"
> {
  const store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
    },
    key: (index) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  };
}
// ~/~ end
