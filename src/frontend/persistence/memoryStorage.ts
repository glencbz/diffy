// ~/~ begin <<docs/architecture/frontend/index.md#frontend-persistence-memory-storage>>[init]
export function memoryStorage(): Pick<Storage, "getItem" | "setItem"> {
  const store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
  };
}
// ~/~ end
