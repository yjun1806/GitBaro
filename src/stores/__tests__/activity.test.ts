import { beforeEach, describe, expect, it } from "vitest";
import {
  MAX_ENTRIES,
  reconcileRehydrated,
  useActivityStore,
} from "@/stores/activity";
import type { GitCommandEntry } from "@/types";

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

function entryIds(): string[] {
  return useActivityStore.getState().entries.map((e) => e.id);
}

describe("useActivityStore", () => {
  beforeEach(() => {
    useActivityStore.setState({ entries: [], activeOperations: {} });
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

      const { entries, activeOperations } = useActivityStore.getState();
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

      expect(useActivityStore.getState().activeOperations["a"]).toBeDefined();
    });

    it("성공하면 로그에 남기지 않는다", () => {
      const { addStart, addComplete } = useActivityStore.getState();
      addStart(makeStart("a", { automatic: true }));

      addComplete("a", { completedAt: 2_000, success: true, durationMs: 100 });

      expect(entryIds()).toEqual([]);
      expect(useActivityStore.getState().activeOperations).toEqual({});
    });

    it("실패하면 로그에 남긴다", () => {
      const { addStart, addComplete } = useActivityStore.getState();
      addStart(makeStart("a", { automatic: true }));

      addComplete("a", {
        completedAt: 2_000,
        success: false,
        stderr: "authentication failed",
      });

      const { entries, activeOperations } = useActivityStore.getState();
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ id: "a", success: false });
      expect(activeOperations).toEqual({});
    });

    it("진행 중에는 activeOperations를 갱신한다", () => {
      const { addStart, updateProgress } = useActivityStore.getState();
      addStart(makeStart("a", { automatic: true }));

      updateProgress("a", "receiving objects", 42);

      expect(useActivityStore.getState().activeOperations["a"].progress).toEqual({
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

  // 상한은 메모리 액션에서만 적용된다. 저장된 값은 hydrate 때 그대로 올라오므로
  // 여기서 자르지 않으면, 자동 작업만 도는 사용자에게는 상한이 영영 작동하지 않는다
  // (자동 경로는 addStart·addComplete 양쪽에서 capEntries를 우회한다).
  describe("hydrate 보정", () => {
    it("저장된 로그가 상한을 넘으면 자른다", () => {
      const state = {
        entries: Array.from({ length: 3000 }, (_, i) => makeStart(`e${i}`)),
      };

      reconcileRehydrated(state);

      expect(state.entries).toHaveLength(MAX_ENTRIES);
      expect(state.entries[0].id).toBe("e0");
    });

    it("상한 이하면 그대로 둔다", () => {
      const state = { entries: [makeStart("a"), makeStart("b")] };

      reconcileRehydrated(state);

      expect(state.entries).toHaveLength(2);
    });

    it("hydrate에 실패해 state가 없으면 아무 일도 하지 않는다", () => {
      expect(() => reconcileRehydrated(undefined)).not.toThrow();
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
