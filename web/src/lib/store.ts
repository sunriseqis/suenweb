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
      // 浅比较：patch 与当前 state 逐键全等则跳过合并与通知
      let changed = false;
      for (const key of Object.keys(patch) as (keyof T)[]) {
        if (!Object.is(state[key], patch[key])) { changed = true; break; }
      }
      if (!changed) return;
      state = { ...state, ...patch };
      for (const listener of listeners) listener(state);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
