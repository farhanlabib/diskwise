export interface Store<T> {
  get(): T;
  set(next: T): void;
  update(updater: (current: T) => T): void;
  subscribe(listener: () => void): () => void;
}

export function createStore<T>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();

  const set = (next: T): void => {
    state = next;
    for (const listener of [...listeners]) listener();
  };

  return {
    get: () => state,
    set,
    update: (updater) => {
      set(updater(state));
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
