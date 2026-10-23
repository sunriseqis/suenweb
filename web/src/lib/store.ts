export type Listener<T> = (state: T) => void;

export type Store<T> = {
  get: () => T;
  set: (patch: Partial<T>) => void;
  subscribe: (listener: Listener<T>) => () => void;
};

export function createStore<T extends object>(initial: T): Store<T> {
  let state = { ...initial };
  const listeners = new Set<Listener<T>>();
  return {
    get: () => state,
    set: (patch) => {
      state = { ...state, ...patch };
      for (const listener of listeners) listener(state);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
