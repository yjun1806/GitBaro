// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { findOwnerRepo, useRepositoryStore } from "@/stores/repository";
import type { RepoInfo } from "@/types";

const MAIN_A = "/repos/alpha";
const WT_A = "/repos/alpha-worktrees/feature";
const MAIN_B = "/repos/beta";

function makeRepo(path: string): RepoInfo {
  return {
    path,
    name: path.split("/").pop()!,
    currentBranch: "main",
    isDirty: false,
    remotes: [],
    accountId: null,
  };
}

function state() {
  return useRepositoryStore.getState();
}

describe("useRepositoryStore", () => {
  beforeEach(() => {
    useRepositoryStore.setState({
      repos: [makeRepo(MAIN_A), makeRepo(MAIN_B)],
      activeRepoPath: null,
      activeRepo: null,
      activeWorktrees: {},
    });
  });

  describe("워크트리를 보던 위치 기억", () => {
    it("워크트리에 있어도 activeRepo는 소유 저장소를 가리킨다", () => {
      state().setActiveRepo(WT_A, MAIN_A);

      expect(state().activeRepoPath).toBe(WT_A);
      expect(state().activeRepo?.path).toBe(MAIN_A);
    });

    it("전환만으로는 기억하지 않는다 — 열리는 데 성공해야 남는다", () => {
      state().setActiveRepo(WT_A, MAIN_A);

      expect(state().activeWorktrees).toEqual({});
    });

    it("기록하면 저장소별로 남는다", () => {
      state().rememberWorktree(MAIN_A, WT_A);

      expect(state().activeWorktrees).toEqual({ [MAIN_A]: WT_A });
    });

    it("null로 기록하면 지워진다", () => {
      state().rememberWorktree(MAIN_A, WT_A);
      state().rememberWorktree(MAIN_A, null);

      expect(state().activeWorktrees).toEqual({});
    });

    it("같은 값을 다시 기록해도 객체를 새로 만들지 않는다", () => {
      state().rememberWorktree(MAIN_A, WT_A);
      const before = state().activeWorktrees;
      state().rememberWorktree(MAIN_A, WT_A);

      expect(state().activeWorktrees).toBe(before);
    });

    it("다른 저장소에 갔다 돌아오면 마지막 워크트리로 복원한다", () => {
      state().rememberWorktree(MAIN_A, WT_A);
      state().activateRepo(MAIN_B);
      state().activateRepo(MAIN_A);

      expect(state().activeRepoPath).toBe(WT_A);
      expect(state().activeRepo?.path).toBe(MAIN_A);
    });

    it("기억이 없으면 저장소 경로를 그대로 활성화한다", () => {
      state().activateRepo(MAIN_A);

      expect(state().activeRepoPath).toBe(MAIN_A);
    });
  });

  describe("저장소 삭제", () => {
    it("워크트리를 보던 중 그 저장소를 지우면 활성 경로를 비운다", () => {
      state().setActiveRepo(WT_A, MAIN_A);
      state().rememberWorktree(MAIN_A, WT_A);
      state().removeRepo(MAIN_A);

      expect(state().activeRepoPath).toBeNull();
      expect(state().activeRepo).toBeNull();
      expect(state().activeWorktrees).toEqual({});
    });

    it("다른 저장소를 지워도 현재 워크트리는 유지된다", () => {
      state().setActiveRepo(WT_A, MAIN_A);
      state().rememberWorktree(MAIN_A, WT_A);
      state().removeRepo(MAIN_B);

      expect(state().activeRepoPath).toBe(WT_A);
      expect(state().activeRepo?.path).toBe(MAIN_A);
    });
  });
});

describe("findOwnerRepo", () => {
  const repos = [makeRepo(MAIN_A), makeRepo(MAIN_B)];

  it("활성 경로가 저장소 경로면 그 저장소를 찾는다", () => {
    expect(findOwnerRepo(repos, MAIN_B, {})?.path).toBe(MAIN_B);
  });

  it("활성 경로가 워크트리면 소유 저장소를 역추적한다", () => {
    expect(findOwnerRepo(repos, WT_A, { [MAIN_A]: WT_A })?.path).toBe(MAIN_A);
  });

  it("활성 경로가 없으면 null이다", () => {
    expect(findOwnerRepo(repos, null, {})).toBeNull();
  });

  it("목록에 없는 저장소면 null이다", () => {
    expect(findOwnerRepo(repos, "/repos/gone", {})).toBeNull();
  });
});
