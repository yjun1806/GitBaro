import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StateStorage } from "zustand/middleware";
import { createDebouncedStorage } from "@/lib/debounced-storage";

function makeBacking(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const setItem = vi.fn((k: string, v: string) => void data.set(k, v));
  const backing: StateStorage = {
    getItem: (k) => data.get(k) ?? null,
    setItem,
    removeItem: (k) => void data.delete(k),
  };
  return { backing, setItem, data };
}

describe("createDebouncedStorage", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("대기 시간 안의 쓰기를 마지막 값 하나로 합친다", () => {
    const { backing, setItem } = makeBacking();
    const storage = createDebouncedStorage(backing, 1000);

    storage.setItem("k", "1");
    storage.setItem("k", "2");
    storage.setItem("k", "3");
    expect(setItem).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);

    expect(setItem).toHaveBeenCalledTimes(1);
    expect(setItem).toHaveBeenCalledWith("k", "3");
  });

  it("직전에 저장한 값과 같으면 쓰지 않는다", () => {
    const { backing, setItem } = makeBacking({ k: "same" });
    const storage = createDebouncedStorage(backing, 1000);
    storage.getItem("k");

    storage.setItem("k", "same");
    vi.advanceTimersByTime(1000);

    expect(setItem).not.toHaveBeenCalled();
  });

  it("대기 중인 값을 getItem이 돌려준다", () => {
    const { backing } = makeBacking();
    const storage = createDebouncedStorage(backing, 1000);
    storage.setItem("k", "pending");

    expect(storage.getItem("k")).toBe("pending");
  });

  it("창이 포커스를 잃으면 즉시 저장한다", () => {
    const fakeWindow = new EventTarget();
    vi.stubGlobal("window", fakeWindow);
    const { backing, setItem } = makeBacking();
    const storage = createDebouncedStorage(backing, 1000);
    storage.setItem("k", "v");

    fakeWindow.dispatchEvent(new Event("blur"));
    vi.unstubAllGlobals();

    expect(setItem).toHaveBeenCalledWith("k", "v");
  });
});
