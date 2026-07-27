import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ACTIVITY_LOG_KEY,
  MAX_ACTIVITY_LOG_CHARS,
  purgeOversizedActivityLog,
} from "@/lib/storage-cleanup";

function makeFakeStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial));
  return {
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
    clear: () => map.clear(),
  };
}

/** 진단 시점 실측값: 8,586건 / 2,617,709자 */
const LEGACY_SIZE = 2_617_709;

describe("purgeOversizedActivityLog", () => {
  it("임계값을 넘긴 활동 로그를 제거한다", () => {
    const storage = makeFakeStorage({
      [ACTIVITY_LOG_KEY]: "x".repeat(LEGACY_SIZE),
    });

    const purged = purgeOversizedActivityLog(storage);

    expect(purged).toBe(true);
    expect(storage.getItem(ACTIVITY_LOG_KEY)).toBeNull();
  });

  it("임계값 이하면 그대로 둔다", () => {
    const value = "x".repeat(MAX_ACTIVITY_LOG_CHARS - 1);
    const storage = makeFakeStorage({ [ACTIVITY_LOG_KEY]: value });

    const purged = purgeOversizedActivityLog(storage);

    expect(purged).toBe(false);
    expect(storage.getItem(ACTIVITY_LOG_KEY)).toBe(value);
  });

  it("활동 로그 키가 없으면 아무 일도 하지 않는다", () => {
    const storage = makeFakeStorage();

    expect(purgeOversizedActivityLog(storage)).toBe(false);
  });

  // 정리는 매 부팅마다 실행된다. 두 번째 실행에서 정상 크기의 로그를
  // 지워버리면 사용자는 로그가 계속 사라지는 앱을 쓰게 된다.
  it("두 번 실행해도 두 번째에는 지우지 않는다", () => {
    const storage = makeFakeStorage({
      [ACTIVITY_LOG_KEY]: "x".repeat(LEGACY_SIZE),
    });

    expect(purgeOversizedActivityLog(storage)).toBe(true);

    storage.setItem(ACTIVITY_LOG_KEY, "x".repeat(1000));
    expect(purgeOversizedActivityLog(storage)).toBe(false);
    expect(storage.getItem(ACTIVITY_LOG_KEY)).toBe("x".repeat(1000));
  });

  it("다른 스토어의 키는 건드리지 않는다", () => {
    const storage = makeFakeStorage({
      [ACTIVITY_LOG_KEY]: "x".repeat(LEGACY_SIZE),
      "gitbaro-repos": "repos-data",
      "gitbaro-accounts": "accounts-data",
    });

    purgeOversizedActivityLog(storage);

    expect(storage.getItem("gitbaro-repos")).toBe("repos-data");
    expect(storage.getItem("gitbaro-accounts")).toBe("accounts-data");
  });

  // 부팅 경로에서 돌기 때문에 어떤 예외도 앱 시작을 막아서는 안 된다.
  it("저장소 접근이 실패해도 예외를 던지지 않는다", () => {
    const storage = makeFakeStorage();
    storage.getItem = () => {
      throw new Error("storage unavailable");
    };

    expect(() => purgeOversizedActivityLog(storage)).not.toThrow();
    expect(purgeOversizedActivityLog(storage)).toBe(false);
  });

  it("삭제가 실패해도 예외를 던지지 않는다", () => {
    const storage = makeFakeStorage({
      [ACTIVITY_LOG_KEY]: "x".repeat(LEGACY_SIZE),
    });
    storage.removeItem = () => {
      throw new Error("remove failed");
    };

    expect(() => purgeOversizedActivityLog(storage)).not.toThrow();
  });
});

// zustand persist는 모듈 import 시점에 hydrate한다. 정리가 App보다 늦게 돌면
// 이미 비대한 데이터가 메모리에 올라온 뒤라 의미가 없다. import 순서가 곧 계약이다.
describe("main.tsx import 순서", () => {
  it("storage-cleanup을 App보다 먼저 import한다", () => {
    const source = readFileSync(
      new URL("../../main.tsx", import.meta.url),
      "utf8",
    );

    const cleanupAt = source.indexOf('"./lib/storage-cleanup"');
    const appAt = source.indexOf('from "./App"');

    expect(cleanupAt).toBeGreaterThan(-1);
    expect(appAt).toBeGreaterThan(-1);
    expect(cleanupAt).toBeLessThan(appAt);
  });
});
