import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_ENTRIES,
  sanitizePersistedEntries,
  useActivityStore,
} from "@/stores/activity";
import { useLiveOperationsStore } from "@/stores/live-operations";
import type { GitCommandEntry } from "@/types";

// 테스트 환경(node)에는 localStorage가 없어 persist가 붙지 않는다. 스토어 모듈이 만들어지기 전에
// 가짜 localStorage를 심어 실제 저장 경로(디바운스 래퍼 포함)를 탄다.
const { backing, setItem } = vi.hoisted(() => {
  const backing = new Map<string, string>();
  const setItem = vi.fn((k: string, v: string) => void backing.set(k, v));
  const fake = {
    getItem: (k: string) => backing.get(k) ?? null,
    setItem,
    removeItem: (k: string) => void backing.delete(k),
  };
  Object.assign(globalThis, {
    window: { localStorage: fake, addEventListener: () => {} },
  });
  return { backing, setItem };
});

function makeStart(
  id: string,
  overrides: Partial<GitCommandEntry> = {},
): GitCommandEntry {
  return {
    id,
    command: "git fetch --prune origin",
    operation: "fetch",
    repoPath: "/repo",
    startedAt: 1_000,
    ...overrides,
  };
}

function entries2(): number {
  return useActivityStore.getState().entries.length;
}

function entryIds(): string[] {
  return useActivityStore.getState().entries.map((e) => e.id);
}

describe("useActivityStore", () => {
  beforeEach(() => {
    // 저장 디바운스 타이머가 테스트 사이로 새지 않도록 파일 전체를 가짜 타이머로 돈다.
    vi.useFakeTimers();
    useActivityStore.setState({ entries: [] });
    useLiveOperationsStore.setState({ activeOperations: {} });
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  describe("사용자가 실행한 작업", () => {
    it("시작 즉시 로그에 남는다", () => {
      useActivityStore
        .getState()
        .addStart(makeStart("a", { operation: "push", command: "git push" }));

      expect(entryIds()).toEqual(["a"]);
    });

    it("완료 시 기존 항목을 갱신한다 (새로 만들지 않는다)", () => {
      const { addStart, addComplete } = useActivityStore.getState();
      addStart(makeStart("a", { operation: "push" }));

      addComplete("a", { completedAt: 2_000, success: true, durationMs: 500 });

      const { entries } = useActivityStore.getState();
      const { activeOperations } = useLiveOperationsStore.getState();
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ id: "a", success: true, durationMs: 500 });
      expect(activeOperations).toEqual({});
    });
  });

  // 자동 폴링이 로그의 99%를 차지해 실제 사용자 행동을 파묻었다.
  // 성공한 자동 작업은 남길 가치가 없다.
  describe("앱이 자동으로 실행한 작업", () => {
    it("시작해도 로그에 남지 않는다", () => {
      useActivityStore.getState().addStart(makeStart("a", { automatic: true }));

      expect(entryIds()).toEqual([]);
    });

    it("진행 표시용 activeOperations에는 등록된다", () => {
      useActivityStore.getState().addStart(makeStart("a", { automatic: true }));

      expect(useLiveOperationsStore.getState().activeOperations["a"]).toBeDefined();
    });

    it("성공하면 로그에 남기지 않는다", () => {
      const { addStart, addComplete } = useActivityStore.getState();
      addStart(makeStart("a", { automatic: true }));

      addComplete("a", { completedAt: 2_000, success: true, durationMs: 100 });

      expect(entryIds()).toEqual([]);
      expect(useLiveOperationsStore.getState().activeOperations).toEqual({});
    });

    it("실패하면 로그에 남긴다", () => {
      const { addStart, addComplete } = useActivityStore.getState();
      addStart(makeStart("a", { automatic: true }));

      addComplete("a", {
        completedAt: 2_000,
        success: false,
        stderr: "authentication failed",
      });

      const { entries } = useActivityStore.getState();
      const { activeOperations } = useLiveOperationsStore.getState();
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ id: "a", success: false });
      expect(activeOperations).toEqual({});
    });

    it("진행 중에는 activeOperations를 갱신한다", () => {
      const { addStart, updateProgress } = useActivityStore.getState();
      addStart(makeStart("a", { automatic: true }));

      updateProgress("a", "receiving objects", 42);

      expect(useLiveOperationsStore.getState().activeOperations["a"].progress).toEqual({
        message: "receiving objects",
        percent: 42,
      });
    });
  });

  // 상한이 없어 8,586건까지 늘어난 것이 이 버그의 근본 원인이다.
  describe(`엔트리 상한 (${MAX_ENTRIES}건)`, () => {
    it("상한을 넘으면 가장 오래된 것부터 버린다", () => {
      const { addStart } = useActivityStore.getState();
      for (let i = 0; i < MAX_ENTRIES + 50; i++) {
        addStart(makeStart(`e${i}`, { operation: "push" }));
      }

      const { entries } = useActivityStore.getState();
      expect(entries).toHaveLength(MAX_ENTRIES);
      // entries는 최신순이므로 맨 앞이 마지막에 추가된 항목이다.
      expect(entries[0].id).toBe(`e${MAX_ENTRIES + 49}`);
      expect(entries[entries.length - 1].id).toBe("e50");
    });

    it("실패한 자동 작업이 추가될 때도 상한을 지킨다", () => {
      const { addStart, addComplete } = useActivityStore.getState();
      for (let i = 0; i < MAX_ENTRIES; i++) {
        addStart(makeStart(`e${i}`, { operation: "push" }));
      }

      addStart(makeStart("auto", { automatic: true }));
      addComplete("auto", { completedAt: 2_000, success: false });

      const { entries } = useActivityStore.getState();
      expect(entries).toHaveLength(MAX_ENTRIES);
      expect(entries[0].id).toBe("auto");
    });
  });

  describe("hydrate 보정", () => {
    it("저장된 로그가 상한을 넘으면 자른다", () => {
      const entries = Array.from({ length: 3000 }, (_, i) => makeStart(`e${i}`));

      const result = sanitizePersistedEntries({ entries });

      expect(result).toHaveLength(MAX_ENTRIES);
      expect(result[0].id).toBe("e0");
    });

    it("예전 형태(progress, 긴 stderr)를 읽어도 progress를 버리고 stderr를 자른다", () => {
      const old = makeStart("a", {
        completedAt: 2_000,
        success: false,
        progress: { message: "Receiving objects", percent: 5 },
        stderr: "x".repeat(100_000) + "fatal: end",
      });

      const [loaded] = sanitizePersistedEntries({ entries: [old] });

      expect(loaded.progress).toBeUndefined();
      expect(loaded.stderr!.length).toBeLessThanOrEqual(4097);
      expect(loaded.stderr!.endsWith("fatal: end")).toBe(true);
    });

    it("깨진 값이면 빈 로그로 시작한다", () => {
      expect(sanitizePersistedEntries(undefined)).toEqual([]);
      expect(sanitizePersistedEntries({ entries: "nope" })).toEqual([]);
      expect(sanitizePersistedEntries({ entries: [null, 3, makeStart("ok")] })).toHaveLength(1);
    });
  });

  describe("저장 부하", () => {
    beforeEach(() => {
      vi.runOnlyPendingTimers();
      backing.clear();
      setItem.mockClear();
    });

    it("진행률 갱신은 entries를 바꾸지 않고 저장도 일으키지 않는다", () => {
      useActivityStore.getState().addStart(makeStart("a", { operation: "push" }));
      vi.advanceTimersByTime(10_000);
      const entriesBefore = useActivityStore.getState().entries;

      for (let i = 0; i < 300; i++) {
        useActivityStore.getState().updateProgress("a", "Receiving objects", i % 100);
      }
      vi.advanceTimersByTime(10_000);

      expect(useActivityStore.getState().entries).toBe(entriesBefore);
      expect(setItem).not.toHaveBeenCalled();
    });

    it("짧은 시간의 여러 변경은 쓰기 한 번으로 합쳐진다", () => {
      for (let i = 0; i < 5; i++) {
        useActivityStore.getState().addStart(makeStart(`p${i}`, { operation: "push" }));
        useActivityStore.getState().addComplete(`p${i}`, { completedAt: 2_000 + i, success: true });
      }
      vi.advanceTimersByTime(10_000);

      expect(setItem).toHaveBeenCalledTimes(1);
    });

    it("저장되는 stderr는 4KB 끝부분이고 메모리에는 전체가 남는다", () => {
      const full = "a".repeat(50_000) + "fatal: boom";
      useActivityStore.getState().addStart(makeStart("a", { operation: "push" }));
      useActivityStore.getState().addComplete("a", { completedAt: 2_000, success: false, stderr: full });
      vi.advanceTimersByTime(10_000);

      const stored = JSON.parse(backing.get("gitbaro-activity-log")!);
      const saved = stored.state.entries[0].stderr as string;
      expect(saved.length).toBeLessThanOrEqual(4097);
      expect(saved.endsWith("fatal: boom")).toBe(true);
      expect(useActivityStore.getState().entries[0].stderr).toBe(full);
    });
  });

  describe("반복되는 자동 실패", () => {
    function autoFail(id: string, at: number, stderr = "fatal: repository not found") {
      const { addStart, addComplete } = useActivityStore.getState();
      addStart(makeStart(id, { automatic: true }));
      addComplete(id, { completedAt: at, success: false, stderr });
    }

    it("같은 저장소·작업·오류면 한 항목에 횟수로 합친다", () => {
      autoFail("a", 2_000);
      autoFail("b", 3_000);
      autoFail("c", 4_000);

      const { entries } = useActivityStore.getState();
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ id: "a", count: 3, completedAt: 4_000 });
    });

    it("오류가 다르면 새 항목이다", () => {
      autoFail("a", 2_000);
      autoFail("b", 3_000, "fatal: other");

      expect(entryIds()).toEqual(["b", "a"]);
    });

    it("다른 저장소의 같은 오류는 합치지 않는다", () => {
      autoFail("a", 2_000);
      const { addStart, addComplete } = useActivityStore.getState();
      addStart(makeStart("b", { automatic: true, repoPath: "/other" }));
      addComplete("b", { completedAt: 3_000, success: false, stderr: "fatal: repository not found" });

      expect(entries2()).toBe(2);
    });
  });

  describe("clearLog", () => {
    it("진행 중인 작업만 남기고 지운다", () => {
      const { addStart, addComplete, clearLog } = useActivityStore.getState();
      addStart(makeStart("done", { operation: "push" }));
      addComplete("done", { completedAt: 2_000, success: true });
      addStart(makeStart("running", { operation: "pull" }));

      clearLog();

      expect(entryIds()).toEqual(["running"]);
    });
  });
});
