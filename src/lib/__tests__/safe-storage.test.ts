import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSafeStorage,
  onStorageFailure,
  resetSafeStorageState,
} from "@/lib/safe-storage";

/**
 * 용량 제한이 있는 가짜 Storage. 한도를 넘기면 실제 브라우저처럼
 * QuotaExceededError를 던진다.
 */
function makeFakeStorage(quota = Infinity): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => map.get(k) ?? null,
    removeItem: (k) => {
      map.delete(k);
    },
    clear: () => map.clear(),
    setItem: (k, v) => {
      const used = [...map.entries()].reduce(
        (sum, [key, val]) => (key === k ? sum : sum + key.length + val.length),
        0,
      );
      if (used + k.length + v.length > quota) {
        const err = new Error("quota exceeded");
        err.name = "QuotaExceededError";
        throw err;
      }
      map.set(k, v);
    },
  };
}

describe("createSafeStorage", () => {
  beforeEach(() => {
    resetSafeStorageState();
  });

  it("정상일 때는 backing storage에 그대로 위임한다", () => {
    const backing = makeFakeStorage();
    const storage = createSafeStorage(backing);

    storage.setItem("k", "v");

    expect(storage.getItem("k")).toBe("v");
    expect(backing.getItem("k")).toBe("v");
  });

  it("removeItem을 backing storage에 위임한다", () => {
    const backing = makeFakeStorage();
    const storage = createSafeStorage(backing);
    storage.setItem("k", "v");

    storage.removeItem("k");

    expect(storage.getItem("k")).toBeNull();
  });

  it("없는 키는 null을 돌려준다", () => {
    const storage = createSafeStorage(makeFakeStorage());

    expect(storage.getItem("nope")).toBeNull();
  });

  // 이 테스트가 버그의 핵심이다. zustand persist는 setItem 예외를 잡지 않아
  // addRepo() 호출부까지 전파되고, 그 뒤 줄(다이얼로그 닫기 등)이 실행되지 않았다.
  it("쿼터를 넘겨도 예외를 던지지 않는다", () => {
    const storage = createSafeStorage(makeFakeStorage(10));

    expect(() => storage.setItem("key", "x".repeat(100))).not.toThrow();
  });

  it("쿼터를 넘기면 실패 리스너를 호출한다", () => {
    const listener = vi.fn();
    onStorageFailure(listener);
    const storage = createSafeStorage(makeFakeStorage(10));

    storage.setItem("gitbaro-repos", "x".repeat(100));

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith("gitbaro-repos");
  });

  // 쿼터가 찬 상태에서는 상태가 바뀔 때마다 저장이 실패한다.
  // 억제하지 않으면 토스트가 초당 수십 개 뜬다.
  it("실패가 반복돼도 리스너는 세션당 한 번만 호출한다", () => {
    const listener = vi.fn();
    onStorageFailure(listener);
    const storage = createSafeStorage(makeFakeStorage(10));

    storage.setItem("a", "x".repeat(100));
    storage.setItem("b", "x".repeat(100));
    storage.setItem("c", "x".repeat(100));

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("여러 스토어가 각자 storage를 만들어도 알림은 한 번뿐이다", () => {
    const listener = vi.fn();
    onStorageFailure(listener);
    const backing = makeFakeStorage(10);

    createSafeStorage(backing).setItem("repos", "x".repeat(100));
    createSafeStorage(backing).setItem("ui", "x".repeat(100));

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("리스너 구독을 해제할 수 있다", () => {
    const listener = vi.fn();
    const unsubscribe = onStorageFailure(listener);
    unsubscribe();
    const storage = createSafeStorage(makeFakeStorage(10));

    storage.setItem("k", "x".repeat(100));

    expect(listener).not.toHaveBeenCalled();
  });

  it("리스너가 던진 예외가 저장 경로로 새어나가지 않는다", () => {
    onStorageFailure(() => {
      throw new Error("listener boom");
    });
    const storage = createSafeStorage(makeFakeStorage(10));

    expect(() => storage.setItem("k", "x".repeat(100))).not.toThrow();
  });

  it("쿼터가 아닌 다른 저장 실패도 삼킨다", () => {
    const backing = makeFakeStorage();
    backing.setItem = () => {
      throw new Error("storage is disabled");
    };
    const storage = createSafeStorage(backing);

    expect(() => storage.setItem("k", "v")).not.toThrow();
  });
});
