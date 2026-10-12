import type { StateStorage } from "zustand/middleware";

/**
 * 쓰기를 모으는 StateStorage 래퍼.
 *
 * 첫 쓰기 후 `delayMs` 안에 들어온 쓰기는 마지막 값 하나로 합친다(타이머를 밀지 않으므로
 * 계속 쓰이는 상태에서도 `delayMs`마다는 저장된다). 직전에 실제로 저장한 값과 같으면 쓰지
 * 않는다. 창이 닫히거나 포커스를 잃으면 대기 중인 값을 즉시 저장한다.
 */
export function createDebouncedStorage(
  backing: StateStorage,
  delayMs = 1000,
): StateStorage {
  const pending = new Map<string, string>();
  const lastWritten = new Map<string, string>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  function flush(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    for (const [name, value] of pending) {
      if (lastWritten.get(name) === value) continue;
      lastWritten.set(name, value);
      void backing.setItem(name, value);
    }
    pending.clear();
  }

  if (typeof window !== "undefined") {
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
    window.addEventListener("blur", flush);
  }

  return {
    getItem: (name) => {
      const queued = pending.get(name);
      if (queued !== undefined) return queued;
      const value = backing.getItem(name);
      if (typeof value === "string") lastWritten.set(name, value);
      return value;
    },

    removeItem: (name) => {
      pending.delete(name);
      lastWritten.delete(name);
      return backing.removeItem(name);
    },

    setItem: (name, value) => {
      pending.set(name, value);
      if (timer === null) timer = setTimeout(flush, delayMs);
    },
  };
}
